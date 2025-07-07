import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { Task } from './common/interfaces/task.interface';
import { QueueModuleOptions } from './queue.module';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    // The options are now injected directly by a factory provider
    @Inject('QUEUE_OPTIONS') private readonly options: QueueModuleOptions,
    // The queue is also injected by the factory provider
    private readonly pendingQueue: Queue,
  ) {
    this.logger.log(`QueueService for "${this.options.name || 'default'}" initialized with queue: ${this.pendingQueue.name}`);
  }

  /**
   * 添加任务到待调度队列
   * @param task 任务对象
   * @returns Promise<Job> 返回 BullMQ Job 对象
   */
  async add(task: Task): Promise<Job> {
    this.logger.log(`Adding task to queue ${this.pendingQueue.name}: ${JSON.stringify(task)}`);
    
    const job = await this.pendingQueue.add(
      'pending-task',
      task,
      {
        // 任务选项
        removeOnComplete: 100, // 保留最近 100 个完成的任务
        removeOnFail: 50, // 保留最近 50 个失败的任务
        attempts: 3, // 重试次数
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );

    this.logger.log(`Task added to queue ${this.pendingQueue.name}, Job ID: ${job.id}`);
    return job;
  }

  /**
   * 获取待调度队列状态
   */
  async getQueueStats() {
    const waiting = await this.pendingQueue.getWaiting();
    const active = await this.pendingQueue.getActive();
    const completed = await this.pendingQueue.getCompleted();
    const failed = await this.pendingQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  /**
   * 获取队列实例（用于内部使用）
   */
  getQueue(): Queue {
    return this.pendingQueue;
  }
}