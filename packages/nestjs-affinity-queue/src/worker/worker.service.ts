import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { RedisUtils } from '../common/utils/redis.utils';
import { queueConfig } from '../config/config';

/**
 * Worker 服务
 * 负责创建和管理动态 Worker 实例
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private redis: Redis;
  private workers: Map<string, Worker> = new Map();
  private taskHandlers: Map<string, (payload: any) => Promise<any>> = new Map();
  private workerStates: Map<string, WorkerState> = new Map();

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    this.redis = new Redis(this.config.redisUrl);
  }

  async onModuleInit() {
    this.logger.log('WorkerService 已初始化');
    
    // 清理过期的 Worker 状态
    await this.cleanupExpiredWorkerStates();
    
    // 创建默认的 Worker 实例
    const workerCount = parseInt(process.env.WORKER_COUNT || '1', 10);
    await this.createWorkers(workerCount);
  }

  /**
   * 注册任务处理器
   * @param taskType 任务类型
   * @param handler 处理器函数
   */
  registerHandler(taskType: string, handler: (payload: any) => Promise<any>): void {
    this.taskHandlers.set(taskType, handler);
    this.logger.log(`WorkerService 已注册任务处理器: ${taskType}`);
  }

  /**
   * 创建 Worker 实例
   * @param workerId Worker ID
   * @param maxBatchSize 最大批次大小
   * @returns Worker ID
   */
  async createWorker(workerId: string, maxBatchSize: number = 10): Promise<string> {
    if (this.workers.has(workerId)) {
      this.logger.warn(`Worker ${workerId} 已存在`);
      return workerId;
    }

    try {
      // 初始化 Worker 状态
      const state: WorkerState = {
        workerId,
        status: 'idle',
        currentIdentifyTag: null,
        currentBatchSize: 0,
      };
      this.workerStates.set(workerId, state);
      await this.updateWorkerState(workerId, state);

      // 创建 BullMQ Worker
      const queueName = `${this.config.workerQueuePrefix}-${workerId}`;
      const worker = new Worker(
        queueName,
        async (job) => {
          return await this.processJob(job, workerId, maxBatchSize);
        },
        {
          connection: this.redis,
          concurrency: 1, // 每个 Worker 一次只处理一个任务
        }
      );

      // 设置事件监听器
      worker.on('completed', async (job) => {
        await this.onJobCompleted(job, workerId, maxBatchSize);
      });

      worker.on('failed', async (job, error) => {
        await this.onJobFailed(job, error, workerId, maxBatchSize);
      });

      worker.on('error', (error) => {
        this.logger.error(`Worker ${workerId} 发生错误:`, error);
      });

      this.workers.set(workerId, worker);
      this.logger.log(`WorkerService 创建了 Worker: ${workerId}, 队列: ${queueName}`);

      return workerId;
    } catch (error) {
      this.logger.error(`创建 Worker ${workerId} 失败:`, error);
      throw error;
    }
  }

  /**
   * 创建多个 Worker 实例
   * @param count Worker 数量
   * @param maxBatchSize 最大批次大小
   * @returns Worker ID 数组
   */
  async createWorkers(count: number, maxBatchSize: number = 10): Promise<string[]> {
    const workerIds: string[] = [];
    
    for (let i = 0; i < count; i++) {
      // 使用稳定的 Worker ID 生成策略
      const workerId = this.generateStableWorkerId(i);
      await this.createWorker(workerId, maxBatchSize);
      workerIds.push(workerId);
    }

    this.logger.log(`WorkerService 创建了 ${count} 个 Worker: ${workerIds.join(', ')}`);
    return workerIds;
  }

  /**
   * 生成稳定的 Worker ID
   * 使用进程 ID 和索引，避免每次重启都生成不同的 ID
   * @param index Worker 索引
   * @returns 稳定的 Worker ID
   */
  private generateStableWorkerId(index: number): string {
    const processId = process.pid;
    const hostname = require('os').hostname().replace(/[^a-zA-Z0-9]/g, '');
    return `worker-${hostname}-${processId}-${index}`;
  }

  /**
   * 清理过期的 Worker 状态
   * 移除不再活跃的 Worker 状态记录
   */
  async cleanupExpiredWorkerStates(): Promise<void> {
    try {
      this.logger.log('开始清理过期的 Worker 状态...');
      
      const pattern = `${this.config.workerStatePrefix}:*`;
      const keys = await RedisUtils.scanKeys(this.redis, pattern);
      
      let cleanedCount = 0;
      
      for (const key of keys) {
        try {
          const data = await this.redis.hgetall(key);
          if (data && data.workerId) {
            // 检查该 Worker 是否仍然存在
            const workerExists = this.workers.has(data.workerId);
            
            if (!workerExists) {
              // Worker 不存在，清理状态
              await this.redis.del(key);
              cleanedCount++;
              this.logger.log(`清理了过期 Worker 状态: ${data.workerId}`);
            }
          }
        } catch (error) {
          this.logger.error(`清理 Worker 状态时发生错误 ${key}:`, error);
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.log(`成功清理了 ${cleanedCount} 个过期的 Worker 状态`);
      } else {
        this.logger.log('未发现需要清理的过期 Worker 状态');
      }
    } catch (error) {
      this.logger.error('清理过期 Worker 状态时发生错误:', error);
    }
  }

  /**
   * 处理任务
   */
  private async processJob(job: any, workerId: string, maxBatchSize: number): Promise<any> {
    const task = job.data as Task;
    this.logger.log(`Worker ${workerId} 开始处理任务: ${JSON.stringify(task)}`);

    try {
      // 查找任务处理器
      const handler = this.taskHandlers.get(task.type);
      
      if (!handler) {
        this.logger.error(`未找到任务类型 '${task.type}' 的处理器，可用处理器: ${Array.from(this.taskHandlers.keys()).join(', ')}`);
        throw new Error(`未找到任务类型 '${task.type}' 的处理器`);
      }

      this.logger.log(`Worker ${workerId} 找到处理器，开始执行任务: ${task.type}`);

      // 执行任务
      const result = await handler(task.payload);
      
      this.logger.log(`Worker ${workerId} 完成任务 ${task.type}: ${task.identifyTag}, 结果: ${JSON.stringify(result)}`);
      
      return result;
    } catch (error) {
      this.logger.error(`Worker ${workerId} 处理任务失败:`, error);
      throw error;
    }
  }

  /**
   * 任务完成后的处理
   */
  private async onJobCompleted(job: any, workerId: string, maxBatchSize: number): Promise<void> {
    const task = job.data as Task;
    this.logger.log(`Worker ${workerId} 任务完成事件触发: ${job.id}, 任务类型: ${task.type}`);
    
    // 获取当前状态
    const currentState = this.workerStates.get(workerId);
    
    if (currentState) {
      this.logger.log(`Worker ${workerId} 当前状态: ${JSON.stringify(currentState)}`);
      
      // 检查是否应该重置状态
      const shouldReset = await this.shouldResetWorkerState(workerId, currentState, maxBatchSize);
      
      if (shouldReset) {
        await this.resetWorkerState(workerId);
        this.logger.log(`Worker ${workerId} 完成批次，状态已重置`);
      } else {
        this.logger.log(`Worker ${workerId} 批次未完成，保持当前状态`);
      }
    } else {
      this.logger.warn(`Worker ${workerId} 无法获取当前状态`);
    }
  }

  /**
   * 任务失败后的处理
   */
  private async onJobFailed(job: any, error: Error, workerId: string, maxBatchSize: number): Promise<void> {
    this.logger.error(`Worker ${workerId} 任务失败 ${job.id}:`, error);
    
    // 任务失败也可能需要重置状态
    const currentState = this.workerStates.get(workerId);
    if (currentState) {
      const shouldReset = await this.shouldResetWorkerState(workerId, currentState, maxBatchSize);
      if (shouldReset) {
        await this.resetWorkerState(workerId);
        this.logger.log(`Worker ${workerId} 任务失败后状态已重置`);
      }
    }
  }

  /**
   * 判断是否应该重置 Worker 状态
   */
  private async shouldResetWorkerState(workerId: string, state: WorkerState, maxBatchSize: number): Promise<boolean> {
    // 如果达到最大批次大小，重置状态
    if (state.currentBatchSize >= maxBatchSize) {
      this.logger.log(`Worker ${workerId} 达到最大批次大小 ${maxBatchSize}，需要重置状态`);
      return true;
    }

    // 如果执行队列为空，重置状态
    const queueName = `${this.config.workerQueuePrefix}-${workerId}`;
    const waiting = await this.redis.llen(`bull:${queueName}:waiting`);
    const active = await this.redis.llen(`bull:${queueName}:active`);
    
    this.logger.log(`Worker ${workerId} 队列状态检查: ${queueName}, 等待: ${waiting}, 活跃: ${active}`);
    
    return waiting === 0 && active === 0;
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
    this.logger.log(`Worker ${workerId} 状态已重置: ${JSON.stringify(state)}`);
  }

  /**
   * 更新 Worker 状态
   */
  private async updateWorkerState(workerId: string, state: WorkerState): Promise<void> {
    const key = `${this.config.workerStatePrefix}:${workerId}`;
    
    const data = {
      workerId: state.workerId,
      status: state.status,
      currentIdentifyTag: state.currentIdentifyTag || '',
      currentBatchSize: state.currentBatchSize.toString(),
      lastUpdated: new Date().toISOString(),
    };

    await this.redis.hset(key, data);
    this.logger.log(`Worker ${workerId} 状态已更新: ${JSON.stringify(data)}`);
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
        queueName: `${this.config.workerQueuePrefix}-${workerId}`,
        status: worker.isRunning() ? 'running' : 'stopped',
      });
    }

    return status;
  }

  async onModuleDestroy() {
    // 关闭所有 Worker
    for (const [workerId, worker] of this.workers) {
      await worker.close();
      this.logger.log(`WorkerService 关闭了 Worker: ${workerId}`);
    }
    
    this.workers.clear();
    this.workerStates.clear();
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    this.logger.log('WorkerService 已销毁');
  }
} 