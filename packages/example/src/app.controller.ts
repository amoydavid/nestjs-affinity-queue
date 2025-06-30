import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { QueueService, Task } from 'nestjs-affinity-queue';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * 添加任务到队列
   */
  @Post('tasks')
  async addTask(@Body() task: Task) {
    const job = await this.queueService.add(task);
    return {
      message: '任务已添加到队列',
      jobId: job.id,
      task,
    };
  }

  /**
   * 批量添加测试任务
   */
  @Post('tasks/batch')
  async addBatchTasks(
    @Query('count') count: string = '10',
    @Query('companies') companies: string = '3',
  ) {
    const taskCount = parseInt(count, 10);
    const companyCount = parseInt(companies, 10);
    
    const tasks: Task[] = [];
    
    for (let i = 0; i < taskCount; i++) {
      const companyId = `company-${i % companyCount + 1}`;
      const taskType = i % 2 === 0 ? 'generate-invoice' : 'send-email';
      
      tasks.push({
        type: taskType,
        identifyTag: companyId,
        payload: {
          id: i + 1,
          message: `这是第 ${i + 1} 个任务，属于 ${companyId}`,
          timestamp: new Date().toISOString(),
        },
      });
    }
    
    const jobs = await Promise.all(
      tasks.map(task => this.queueService.add(task))
    );
    
    return {
      message: `成功添加 ${taskCount} 个任务`,
      jobIds: jobs.map(job => job.id),
      tasksPerCompany: Math.ceil(taskCount / companyCount),
    };
  }

  /**
   * 获取队列状态
   */
  @Get('queue/stats')
  async getQueueStats() {
    return await this.queueService.getQueueStats();
  }
} 