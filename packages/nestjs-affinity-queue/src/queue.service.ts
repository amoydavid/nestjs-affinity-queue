import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { Task } from './common/interfaces/task.interface';
import { queueConfig } from './config/config';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
    @InjectQueue('pending-tasks')
    private readonly pendingQueue: Queue,
  ) {}

  /**
   * 添加任务到待调度队列
   * @param task 任务对象
   * @returns Promise<Job> 返回 BullMQ Job 对象
   */
  async add(task: Task): Promise<Job> {
    this.logger.log(`添加任务到待调度队列: ${JSON.stringify(task)}`);
    
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

    this.logger.log(`任务已添加到待调度队列, Job ID: ${job.id}`);
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
} 