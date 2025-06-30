import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { queueConfig } from '../config/config';

@Injectable()
export class SchedulerProcessor implements OnModuleInit {
  private readonly logger = new Logger(SchedulerProcessor.name);
  private redis: Redis;
  private schedulerInterval: NodeJS.Timeout;

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
    @InjectQueue('pending-tasks')
    private readonly pendingQueue: Queue,
  ) {}

  async onModuleInit() {
    // 初始化 Redis 连接
    this.redis = new Redis(this.config.redisUrl);
    
    // 开始调度循环
    this.startScheduling();
    
    this.logger.log('调度器已启动');
  }

  /**
   * 开始调度循环
   */
  private startScheduling() {
    this.schedulerInterval = setInterval(async () => {
      try {
        await this.processScheduling();
      } catch (error) {
        this.logger.error('调度过程中发生错误:', error);
      }
    }, this.config.schedulerInterval);
  }

  /**
   * 核心调度处理逻辑
   */
  private async processScheduling() {
    // 获取待调度的任务
    const waitingJobs = await this.pendingQueue.getWaiting();
    
    if (waitingJobs.length === 0) {
      return;
    }

    this.logger.debug(`发现 ${waitingJobs.length} 个待调度任务`);

    // 获取所有 Worker 状态
    const workerStates = await this.getAllWorkerStates();

    // 遍历每个待调度任务
    for (const job of waitingJobs) {
      const task = job.data as Task;
      
      try {
        const assigned = await this.assignTask(task, workerStates, job);
        if (assigned) {
          this.logger.log(`任务 ${job.id} (${task.identifyTag}) 已分配`);
        }
      } catch (error) {
        this.logger.error(`分配任务 ${job.id} 时发生错误:`, error);
      }
    }
  }

  /**
   * 分配任务给合适的 Worker
   * @param task 任务对象
   * @param workerStates 所有 Worker 状态
   * @param job BullMQ Job 对象
   * @returns boolean 是否成功分配
   */
  private async assignTask(
    task: Task,
    workerStates: WorkerState[],
    job: Job,
  ): Promise<boolean> {
    // 1. 强制亲和性检查
    const affinityWorker = workerStates.find(
      worker => worker.currentIdentifyTag === task.identifyTag && worker.status === 'running'
    );

    if (affinityWorker) {
      // 检查批次是否未满
      if (affinityWorker.currentBatchSize < this.config.defaultMaxBatchSize) {
        return await this.assignToWorker(task, affinityWorker, job);
      } else {
        // 批次已满，强制等待
        this.logger.debug(`任务 ${task.identifyTag} 等待 Worker ${affinityWorker.workerId} 完成当前批次`);
        return false;
      }
    }

    // 2. 空闲节点分配
    const idleWorker = workerStates.find(worker => worker.status === 'idle');
    
    if (idleWorker) {
      return await this.assignToWorker(task, idleWorker, job);
    }

    // 3. 保持等待
    this.logger.debug(`任务 ${task.identifyTag} 等待空闲 Worker`);
    return false;
  }

  /**
   * 将任务分配给指定的 Worker
   */
  private async assignToWorker(
    task: Task,
    worker: WorkerState,
    job: Job,
  ): Promise<boolean> {
    try {
      // 获取 Worker 执行队列
      const workerQueueName = `${this.config.workerQueuePrefix}-${worker.workerId}`;
      const workerQueue = new Queue(workerQueueName, {
        connection: this.redis,
      });

      // 将任务添加到 Worker 执行队列
      await workerQueue.add('execute-task', task, {
        removeOnComplete: 50,
        removeOnFail: 20,
      });

      // 更新 Worker 状态
      await this.updateWorkerState(worker.workerId, {
        status: 'running',
        currentIdentifyTag: task.identifyTag,
        currentBatchSize: worker.status === 'idle' ? 1 : worker.currentBatchSize + 1,
      });

      // 从待调度队列中移除任务
      await job.remove();

      return true;
    } catch (error) {
      this.logger.error(`分配任务给 Worker ${worker.workerId} 时发生错误:`, error);
      return false;
    }
  }

  /**
   * 获取所有 Worker 状态
   */
  private async getAllWorkerStates(): Promise<WorkerState[]> {
    const pattern = `${this.config.workerStatePrefix}:*`;
    const keys = await this.redis.keys(pattern);
    
    const states: WorkerState[] = [];
    
    for (const key of keys) {
      try {
        const data = await this.redis.hgetall(key);
        if (data && data.workerId) {
          states.push({
            workerId: data.workerId,
            status: data.status as 'idle' | 'running',
            currentIdentifyTag: data.currentIdentifyTag || null,
            currentBatchSize: parseInt(data.currentBatchSize || '0', 10),
          });
        }
      } catch (error) {
        this.logger.error(`获取 Worker 状态失败 ${key}:`, error);
      }
    }
    
    return states;
  }

  /**
   * 更新 Worker 状态
   */
  private async updateWorkerState(
    workerId: string,
    updates: Partial<WorkerState>,
  ): Promise<void> {
    const key = `${this.config.workerStatePrefix}:${workerId}`;
    
    const updateData: any = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.currentIdentifyTag !== undefined) {
      updateData.currentIdentifyTag = updates.currentIdentifyTag || '';
    }
    if (updates.currentBatchSize !== undefined) {
      updateData.currentBatchSize = updates.currentBatchSize.toString();
    }

    await this.redis.hset(key, updateData);
  }

  /**
   * 清理资源
   */
  async onModuleDestroy() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    this.logger.log('调度器已停止');
  }
} 