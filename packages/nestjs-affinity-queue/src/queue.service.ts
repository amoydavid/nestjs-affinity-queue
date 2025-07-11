import { Injectable, Logger } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { Task } from './common/interfaces/task.interface';
import { QueueModuleOptions } from './queue.module';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly options: QueueModuleOptions | any,
    private readonly pendingQueue: Queue,
  ) {
    this.logger.log(`QueueService initialized: ${this.options.name || 'default'}`);
  }

  /**
   * 添加任务到待调度队列
   * @param task 任务对象
   * @returns Promise<Job> 返回 BullMQ Job 对象
   */
  async add(task: Task): Promise<Job> {
    const job = await this.pendingQueue.add(
      'pending-task',
      task,
      {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );

    this.logger.log(`Task added: ${task.type}(${task.identifyTag}) -> Job ${job.id}`);
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