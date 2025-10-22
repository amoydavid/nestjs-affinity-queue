import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { RedisUtils } from '../common/utils/redis.utils';
import { SchedulerElectionService } from '../scheduler/scheduler.election';
import { QueueModuleOptions } from '../queue.module';

/**
 * Worker 服务
 * 负责创建和管理动态 Worker 实例
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private redis: Redis;
  private workers: Map<string, Worker> = new Map();
  private taskHandlers: Map<string, (payload: any) => Promise<any>> = new Map();
  private workerStates: Map<string, WorkerState> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private readonly options: QueueModuleOptions,
    private readonly electionService: SchedulerElectionService,
  ) {
    this.logger = new Logger(`${WorkerService.name}:${this.options.name || 'default'}`);
    // Since BullMQ instances share redis connections, we can get it from the election service
    // which is guaranteed to have one.
    this.redis = electionService.getRedisClient();
    this.logger.log(`WorkerService for "${this.options.name || 'default'}" initialized.`);
  }

  async onModuleInit() {
    this.logger.log('WorkerService initializing...');
    
    await this.cleanupExpiredWorkerStates();
    
    const workerCount = this.options.workerOptions?.workerCount || 1;
    const workerIds = await this.createWorkers(workerCount);
    
    for (const workerId of workerIds) {
      await this.electionService.registerWorker(workerId, {
        hostname: require('os').hostname(),
        processId: process.pid,
        nodeId: this.electionService.getCurrentNodeId(),
      });
    }
    
    this.startWorkerHeartbeat(workerIds);
  }

  /**
   * 注册任务处理器
   * @param taskType 任务类型
   * @param handler 处理器函数
   */
  registerHandler(taskType: string, handler: (payload: any) => Promise<any>): void {
    this.taskHandlers.set(taskType, handler);
    this.logger.log(`Task handler registered for type: ${taskType}`);
  }

  /**
   * 创建 Worker 实例
   * @param workerId Worker ID
   * @returns Worker ID
   */
  async createWorker(workerId: string): Promise<string> {
    if (this.workers.has(workerId)) {
      this.logger.warn(`Worker ${workerId} already exists.`);
      return workerId;
    }

    try {
      const state: WorkerState = {
        workerId,
        status: 'idle',
        currentIdentifyTag: null,
        currentBatchSize: 0,
      };
      this.workerStates.set(workerId, state);
      await this.updateWorkerState(workerId, state);

      const queueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
      const concurrency = this.options.workerOptions?.concurrency ?? 1;
      const worker = new Worker(
        queueName,
        async (job) => {
          return await this.processJob(job, workerId);
        },
        {
          connection: this.redis,
          concurrency,
        }
      );

      worker.on('completed', async (job) => {
        await this.onJobCompleted(job, workerId);
      });

      worker.on('failed', async (job, error) => {
        await this.onJobFailed(job, error, workerId);
      });

      worker.on('error', (error) => {
        this.logger.error(`Worker ${workerId} encountered an error:`, error);
      });

      this.workers.set(workerId, worker);
      this.logger.log(`Worker created: ${workerId}, listening on queue: ${queueName}`);

      return workerId;
    } catch (error) {
      this.logger.error(`Failed to create worker ${workerId}:`, error);
      throw error;
    }
  }

  /**
   * 创建多个 Worker 实例
   * @param count Worker 数量
   * @returns Worker ID 数组
   */
  async createWorkers(count: number): Promise<string[]> {
    const workerIds: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const workerId = this.generateStableWorkerId(i);
      await this.createWorker(workerId);
      workerIds.push(workerId);
    }

    this.logger.log(`${count} workers created: ${workerIds.join(', ')}`);
    return workerIds;
  }

  /**
   * 生成稳定的 Worker ID
   * 使用进程 ID、队列名称和索引，避免每次重启都生成不同的 ID
   * @param index Worker 索引
   * @returns 稳定的 Worker ID
   */
  private generateStableWorkerId(index: number): string {
    const processId = process.pid;
    const hostname = require('os').hostname().replace(/[^a-zA-Z0-9]/g, '');
    const queueName = this.options.name || 'default';
    return `worker-${queueName}-${hostname}-${processId}-${index}`;
  }

  /**
   * 启动 Worker 心跳
   */
  private startWorkerHeartbeat(workerIds: string[]) {
    this.heartbeatInterval = setInterval(async () => {
      try {
        for (const workerId of workerIds) {
          await this.electionService.updateWorkerHeartbeat(workerId);
        }
      } catch (error) {
        this.logger.error('Failed to update worker heartbeat:', error);
      }
    }, 10000); // 每10秒更新一次心跳
  }

  /**
   * 清理过期的 Worker 状态
   * 移除不再活跃的 Worker 状态记录
   */
  async cleanupExpiredWorkerStates(): Promise<void> {
    try {
      this.logger.log('Cleaning up expired worker states...');
      
      const pattern = `${this.options.queueOptions.workerStatePrefix}:*`;
      const keys = await RedisUtils.scanKeys(this.redis, pattern);
      
      let cleanedCount = 0;
      
      for (const key of keys) {
        try {
          const data = await this.redis.hgetall(key);
          if (data && data.workerId) {
            const workerExists = this.workers.has(data.workerId);
            
            if (!workerExists) {
              await this.redis.del(key);
              cleanedCount++;
              this.logger.log(`Cleaned up expired worker state: ${data.workerId}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error cleaning up worker state for key ${key}:`, error);
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.log(`Successfully cleaned up ${cleanedCount} expired worker states.`);
      } else {
        this.logger.log('No expired worker states found to clean up.');
      }
    } catch (error) {
      this.logger.error('An error occurred during expired worker state cleanup:', error);
    }
  }

  /**
   * 处理任务
   */
  private async processJob(job: Job, workerId: string): Promise<any> {
    const task = job.data as Task;
    this.logger.log(`Worker ${workerId} started processing job: ${JSON.stringify(task)}`);

    try {
      const handler = this.taskHandlers.get(task.type);
      
      if (!handler) {
        throw new Error(`No handler found for task type '${task.type}'. Available handlers: ${Array.from(this.taskHandlers.keys()).join(', ')}`);
      }

      this.logger.log(`Worker ${workerId} found handler, executing task: ${task.type}`);

      const result = await handler(task.payload);
      
      this.logger.log(`Worker ${workerId} finished task ${task.type}: ${task.identifyTag}, result: ${JSON.stringify(result)}`);
      
      return result;
    } catch (error) {
      this.logger.error(`Worker ${workerId} failed to process job:`, error);
      throw error;
    }
  }

  /**
   * 任务完成后的处理
   */
  private async onJobCompleted(job: Job, workerId: string): Promise<void> {
    const task = job.data as Task;
    this.logger.log(`Job completed event for worker ${workerId}: ${job.id}, task type: ${task.type}`);
    
    // 从 Redis 获取最新的 Worker 状态，而不是使用内存中的状态
    const currentState = await this.getWorkerStateFromRedis(workerId);
    
    if (currentState) {
      this.logger.log(`Current state for worker ${workerId}: ${JSON.stringify(currentState)}`);
      
      // 同步更新内存状态
      this.workerStates.set(workerId, currentState);
      
      const shouldReset = await this.shouldResetWorkerState(workerId, currentState);
      
      if (shouldReset) {
        await this.resetWorkerState(workerId);
        this.logger.log(`Worker ${workerId} completed its batch and state has been reset.`);
      } else {
        this.logger.log(`Worker ${workerId} has not completed its batch, maintaining current state.`);
      }
    } else {
      this.logger.warn(`Could not retrieve current state for worker ${workerId} from Redis`);
    }
  }

  /**
   * 任务失败后的处理
   */
  private async onJobFailed(job: Job, error: Error, workerId: string): Promise<void> {
    this.logger.error(`Job failed for worker ${workerId}, job id ${job.id}:`, error);
    
    // 从 Redis 获取最新的 Worker 状态
    const currentState = await this.getWorkerStateFromRedis(workerId);
    if (currentState) {
      // 同步更新内存状态
      this.workerStates.set(workerId, currentState);
      
      const shouldReset = await this.shouldResetWorkerState(workerId, currentState);
      if (shouldReset) {
        await this.resetWorkerState(workerId);
        this.logger.log(`Worker ${workerId} state has been reset after job failure.`);
      }
    }
  }

  /**
   * 从 Redis 获取 Worker 状态
   */
  private async getWorkerStateFromRedis(workerId: string): Promise<WorkerState | null> {
    try {
      const key = `${this.options.queueOptions.workerStatePrefix}:${workerId}`;
      const data = await this.redis.hgetall(key);
      
      if (data && data.workerId) {
        return {
          workerId: data.workerId,
          status: data.status as 'idle' | 'running',
          currentIdentifyTag: data.currentIdentifyTag || null,
          currentBatchSize: parseInt(data.currentBatchSize || '0', 10),
        };
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Failed to get worker state from Redis for ${workerId}:`, error);
      return null;
    }
  }

  /**
   * 判断是否应该重置 Worker 状态
   */
  private async shouldResetWorkerState(workerId: string, state: WorkerState): Promise<boolean> {
    // 1. 如果没有当前处理的身份标识，应该重置状态
    if (!state.currentIdentifyTag) {
      this.logger.log(`Worker ${workerId} has no current identify tag, should reset state.`);
      return true;
    }

    const queueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
    const queue = new Queue(queueName, { connection: this.redis });
    
    try {
      // 2. 检查队列中是否还有任务（不区分identifyTag）
      const counts = await queue.getJobCounts();
      const totalJobs = (counts.wait || counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0) + (counts.prioritized || 0);
      
      this.logger.log(`Worker ${workerId} queue status check: waiting=${counts.wait || counts.waiting}, active=${counts.active}, total=${totalJobs}`);
      
      // 3. 只有当队列完全为空时，才认为当前批次完成
      const shouldReset = totalJobs === 0;
      
      if (shouldReset) {
        this.logger.log(`Worker ${workerId} queue is empty, batch completed for identify tag '${state.currentIdentifyTag}', should reset state.`);
      } else {
        this.logger.log(`Worker ${workerId} still has ${totalJobs} tasks in queue, maintaining state for identify tag '${state.currentIdentifyTag}'.`);
      }
      
      return shouldReset;
    } catch (error) {
      this.logger.error(`Error checking worker ${workerId} queue status:`, error);
      return false;
    } finally {
      await queue.close();
    }
  }

  /**
   * 重置 Worker 状态
   */
  private async resetWorkerState(workerId: string): Promise<void> {
    const state: WorkerState = {
      workerId,
      status: 'idle',
      currentIdentifyTag: null,
      currentBatchSize: 0,
    };

    this.workerStates.set(workerId, state);
    await this.updateWorkerState(workerId, state);
    this.logger.log(`Worker ${workerId} state has been reset: ${JSON.stringify(state)}`);
  }

  /**
   * 更新 Worker 状态
   */
  private async updateWorkerState(workerId: string, state: WorkerState): Promise<void> {
    const key = `${this.options.queueOptions.workerStatePrefix}:${workerId}`;
    
    const data = {
      workerId: state.workerId,
      status: state.status,
      currentIdentifyTag: state.currentIdentifyTag || '',
      currentBatchSize: state.currentBatchSize.toString(),
      lastUpdated: new Date().toISOString(),
    };

    await this.redis.hset(key, data);
    this.logger.log(`Worker ${workerId} state updated: ${JSON.stringify(data)}`);
  }

  /**
   * 获取所有 Worker ID
   * @returns Worker ID 数组
   */
  getAllWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * 获取 Worker 状态信息
   * @returns Worker 状态信息
   */
  getWorkerStatus(): Array<{ workerId: string; queueName: string; status: string }> {
    const status: Array<{ workerId: string; queueName: string; status: string }> = [];
    
    for (const [workerId, worker] of this.workers) {
      status.push({
        workerId,
        queueName: `${this.options.queueOptions.workerQueuePrefix}-${workerId}`,
        status: worker.isRunning() ? 'running' : 'stopped',
      });
    }

    return status;
  }

  async onModuleDestroy() {
    this.logger.log('开始 WorkerService 优雅关闭...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 避免重复关闭
    if (this.workers.size === 0) {
      this.logger.log('WorkerService 已经关闭，跳过重复关闭');
      return;
    }

    // 立即关闭所有 Worker，不等待正在执行的任务完成
    const closePromises = Array.from(this.workers.entries()).map(async ([workerId, worker]) => {
      try {
        // 检查 Worker 是否已经关闭
        if (!worker.isRunning()) {
          this.logger.debug(`Worker ${workerId} 已经关闭，跳过`);
          return;
        }
        
        // 使用 forceClose 立即关闭 Worker，不等待正在执行的任务
        await worker.close(true); // force close
        this.logger.log(`Worker 已强制关闭: ${workerId}`);
      } catch (error) {
        // 忽略连接已关闭等常见错误
        if (error.message && (
          error.message.includes('Connection is closed') ||
          error.message.includes('EPIPE') ||
          error.message.includes('Socket is closed')
        )) {
          this.logger.debug(`Worker ${workerId} 连接已关闭，跳过错误`);
        } else {
          this.logger.error(`关闭 Worker ${workerId} 时发生错误:`, error);
        }
      }
    });

    await Promise.all(closePromises);
    
    this.workers.clear();
    this.workerStates.clear();
    
    this.logger.log('WorkerService 已销毁 - 所有 Worker 已立即关闭');
  }
}
