import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Task } from 'nestjs-affinity-queue';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // ==============================================
  //      Default Queue Endpoints
  // ==============================================

  /**
   * 添加任务到默认队列
   */
  @Post('tasks')
  async addTask(@Body() task: Task) {
    return this.appService.addTask(task);
  }

  /**
   * 批量添加测试任务到默认队列
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
      tasks.map(task => this.appService.addTask(task))
    );
    
    return {
      message: `成功批量添加 ${taskCount} 个任务到默认队列`,
      jobIds: jobs.map(job => job.jobId),
    };
  }

  /**
   * 获取默认队列状态
   */
  @Get('queue/stats')
  async getQueueStats() {
    return this.appService.getDefaultQueueStats();
  }

  // ==============================================
  //      High-Priority Queue Endpoints
  // ==============================================

  /**
   * 添加任务到高优先级队列
   */
  @Post('tasks/high-priority')
  async addHighPriorityTask(@Body() task: Task) {
    return this.appService.addHighPriorityTask(task);
  }

  /**
   * 获取高优先级队列状态
   */
  @Get('queue/stats/high-priority')
  async getHighPriorityQueueStats() {
    return this.appService.getHighPriorityQueueStats();
  }
}