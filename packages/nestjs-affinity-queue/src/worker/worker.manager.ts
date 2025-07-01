import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DynamicWorkerProcessor, WorkerFactory } from './worker.factory';
import { Task } from '../common/interfaces/task.interface';
import { RedisUtils } from '../common/utils/redis.utils';
import { queueConfig } from '../config/config';

/**
 * Worker 管理器
 * 负责创建和管理多个 BullMQ Worker 实例
 */
@Injectable()
export class WorkerManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerManager.name);
  private redis: Redis;
  private workers: Map<string, Worker> = new Map();
  private workerProcessors: Map<string, DynamicWorkerProcessor> = new Map();
  private workerFactory: WorkerFactory;

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    this.redis = new Redis(this.config.redisUrl);
    this.workerFactory = new WorkerFactory(this.config);
  }

  async onModuleInit() {
    this.logger.log('WorkerManager 已初始化');
  }

  /**
   * 注册任务处理器
   * @param taskType 任务类型
   * @param handler 处理器函数
   */
  registerHandler(taskType: string, handler: (payload: any) => Promise<any>): void {
    this.workerFactory.registerHandler(taskType, handler);
    this.logger.log(`WorkerManager 已注册任务处理器: ${taskType}`);
  }

  /**
   * 创建 Worker 实例
   * @param workerId Worker ID
   * @param maxBatchSize 最大批次大小
   * @returns Worker ID
   */
  async createWorker(workerId: string, maxBatchSize?: number): Promise<string> {
    if (this.workers.has(workerId)) {
      this.logger.warn(`Worker ${workerId} 已存在`);
      return workerId;
    }

    try {
      // 创建 Worker 处理器
      const processor = this.workerFactory.createWorker(workerId, maxBatchSize);
      this.workerProcessors.set(workerId, processor);

      // 创建 BullMQ Worker
      const queueName = `${this.config.workerQueuePrefix}-${workerId}`;
      const worker = new Worker(
        queueName,
        async (job) => {
          return await processor.process(job);
        },
        {
          connection: this.redis,
          concurrency: 1, // 每个 Worker 一次只处理一个任务
        }
      );

      // 设置事件监听器
      worker.on('completed', async (job) => {
        await processor.onCompleted(job);
      });

      worker.on('failed', async (job, error) => {
        await processor.onFailed(job, error);
      });

      worker.on('error', (error) => {
        this.logger.error(`Worker ${workerId} 发生错误:`, error);
      });

      this.workers.set(workerId, worker);
      this.logger.log(`WorkerManager 创建了 Worker: ${workerId}, 队列: ${queueName}`);

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
  async createWorkers(count: number, maxBatchSize?: number): Promise<string[]> {
    const workerIds: string[] = [];
    
    for (let i = 0; i < count; i++) {
      // 使用更稳定的 Worker ID 生成策略
      const workerId = this.generateStableWorkerId(i);
      await this.createWorker(workerId, maxBatchSize);
      workerIds.push(workerId);
    }

    this.logger.log(`WorkerManager 创建了 ${count} 个 Worker: ${workerIds.join(', ')}`);
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
   * 获取 Worker 实例
   * @param workerId Worker ID
   * @returns Worker 实例或 null
   */
  getWorker(workerId: string): Worker | null {
    return this.workers.get(workerId) || null;
  }

  /**
   * 获取 Worker 处理器
   * @param workerId Worker ID
   * @returns Worker 处理器或 null
   */
  getWorkerProcessor(workerId: string): DynamicWorkerProcessor | null {
    return this.workerProcessors.get(workerId) || null;
  }

  /**
   * 获取所有 Worker ID
   * @returns Worker ID 数组
   */
  getAllWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * 获取所有 Worker 实例
   * @returns Worker 实例数组
   */
  getAllWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  /**
   * 销毁 Worker 实例
   * @param workerId Worker ID
   */
  async destroyWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    const processor = this.workerProcessors.get(workerId);

    if (worker) {
      await worker.close();
      this.workers.delete(workerId);
      this.logger.log(`WorkerManager 销毁了 Worker: ${workerId}`);
    }

    if (processor) {
      await processor.onModuleDestroy();
      this.workerProcessors.delete(workerId);
    }
  }

  /**
   * 销毁所有 Worker 实例
   */
  async destroyAllWorkers(): Promise<void> {
    const workerIds = Array.from(this.workers.keys());
    
    for (const workerId of workerIds) {
      await this.destroyWorker(workerId);
    }

    this.logger.log('WorkerManager 销毁了所有 Worker');
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

  /**
   * 检查 Worker 是否运行
   * @param workerId Worker ID
   * @returns 是否运行
   */
  isWorkerRunning(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    return worker ? worker.isRunning() : false;
  }

  /**
   * 获取队列信息
   * @param workerId Worker ID
   * @returns 队列信息
   */
  async getQueueInfo(workerId: string): Promise<{ waiting: number; active: number; completed: number; failed: number } | null> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return null;
    }

    const queueName = `${this.config.workerQueuePrefix}-${workerId}`;
    const queue = new Queue(queueName, { connection: this.redis });

    try {
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      const completed = await queue.getCompletedCount();
      const failed = await queue.getFailedCount();

      return { waiting, active, completed, failed };
    } catch (error) {
      this.logger.error(`获取队列信息失败 ${queueName}:`, error);
      return null;
    }
  }

  async onModuleDestroy() {
    await this.destroyAllWorkers();
    if (this.redis) {
      await this.redis.quit();
    }
    this.logger.log('WorkerManager 已销毁');
  }
} 