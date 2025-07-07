import { Injectable, Inject } from '@nestjs/common';
import { QueueService, Task, getQueueServiceToken } from 'nestjs-affinity-queue';

@Injectable()
export class AppService {
  constructor(
    // 注入默认的 QueueService
    private readonly defaultQueueService: QueueService,

    // 注入名为 'high-priority' 的 QueueService
    @Inject(getQueueServiceToken('high-priority')) 
    private readonly highPriorityQueueService: QueueService,
  ) {}

  getHello(): string {
    return 'NestJS Affinity Queue 示例应用运行中！';
  }

  /**
   * 向默认队列添加任务
   */
  async addTask(task: Task) {
    const job = await this.defaultQueueService.add(task);
    return {
      message: '任务已添加到默认队列',
      queue: 'default',
      jobId: job.id,
      task,
    };
  }

  /**
   * 向高优先级队列添加任务
   */
  async addHighPriorityTask(task: Task) {
    const job = await this.highPriorityQueueService.add(task);
    return {
      message: '任务已添加到高优先级队列',
      queue: 'high-priority',
      jobId: job.id,
      task,
    };
  }

  /**
   * 获取默认队列的状态
   */
  async getDefaultQueueStats() {
    return this.defaultQueueService.getQueueStats();
  }

  /**
   * 获取高优先级队列的状态
   */
  async getHighPriorityQueueStats() {
    return this.highPriorityQueueService.getQueueStats();
  }
}