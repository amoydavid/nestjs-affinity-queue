import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Task } from 'nestjs-affinity-queue';
import { AppService } from './app.service';
import { MultiQueueService } from './multi-queue.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly multiQueueService: MultiQueueService
  ) {}

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
  //      Multi-Queue Demo Endpoints
  // ==============================================

  /**
   * 添加默认任务
   */
  @Post('multi-queue/default')
  async addDefaultTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addDefaultTask(body.identifyTag, body.payload);
  }

  /**
   * 添加紧急任务到高优先级队列
   */
  @Post('multi-queue/urgent')
  async addUrgentTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addUrgentTask(body.identifyTag, body.payload);
  }

  /**
   * 添加关键任务到高优先级队列
   */
  @Post('multi-queue/critical')
  async addCriticalTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addCriticalTask(body.identifyTag, body.payload);
  }

  /**
   * 添加邮件任务
   */
  @Post('multi-queue/email')
  async addEmailTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addEmailTask(body.identifyTag, body.payload);
  }

  /**
   * 添加邮件简报任务
   */
  @Post('multi-queue/newsletter')
  async addNewsletterTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addNewsletterTask(body.identifyTag, body.payload);
  }

  /**
   * 添加文件处理任务
   */
  @Post('multi-queue/file-processing')
  async addFileProcessingTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addFileProcessingTask(body.identifyTag, body.payload);
  }

  /**
   * 添加文件压缩任务
   */
  @Post('multi-queue/file-compression')
  async addFileCompressionTask(@Body() body: { identifyTag: string; payload: any }) {
    return this.multiQueueService.addFileCompressionTask(body.identifyTag, body.payload);
  }

  /**
   * 获取所有队列状态
   */
  @Get('multi-queue/stats')
  async getAllQueueStats() {
    return this.multiQueueService.getAllQueueStats();
  }

  /**
   * 批量添加多种队列任务进行演示
   */
  @Post('multi-queue/demo')
  async addDemoTasks(
    @Query('count') count: string = '20',
    @Query('companies') companies: string = '3',
  ) {
    const taskCount = parseInt(count, 10);
    const companyCount = parseInt(companies, 10);
    
    const results = [];
    
    for (let i = 0; i < taskCount; i++) {
      const companyId = `company-${i % companyCount + 1}`;
      const userId = `user-${i + 1}`;
      
      // 根据索引分配不同类型的任务到不同队列
      if (i % 7 === 0) {
        // 默认队列任务
        results.push(await this.multiQueueService.addDefaultTask(companyId, {
          id: i + 1,
          action: 'default-processing',
          duration: 1000,
        }));
      } else if (i % 7 === 1) {
        // 紧急任务
        results.push(await this.multiQueueService.addUrgentTask(companyId, {
          id: i + 1,
          action: 'urgent-processing',
          duration: 500,
        }));
      } else if (i % 7 === 2) {
        // 关键任务
        results.push(await this.multiQueueService.addCriticalTask(companyId, {
          id: i + 1,
          action: 'critical-processing',
          duration: 300,
        }));
      } else if (i % 7 === 3) {
        // 邮件任务
        results.push(await this.multiQueueService.addEmailTask(userId, {
          id: i + 1,
          recipient: `user-${i + 1}@example.com`,
          subject: `Welcome Email ${i + 1}`,
          duration: 2000,
        }));
      } else if (i % 7 === 4) {
        // 邮件简报任务
        results.push(await this.multiQueueService.addNewsletterTask(companyId, {
          id: i + 1,
          subscriberCount: (i + 1) * 10,
          topic: `Newsletter ${i + 1}`,
          duration: 3000,
        }));
      } else if (i % 7 === 5) {
        // 文件处理任务
        results.push(await this.multiQueueService.addFileProcessingTask(companyId, {
          id: i + 1,
          fileName: `document-${i + 1}.pdf`,
          action: 'process',
          duration: 5000,
        }));
      } else {
        // 文件压缩任务
        results.push(await this.multiQueueService.addFileCompressionTask(companyId, {
          id: i + 1,
          fileName: `image-${i + 1}.jpg`,
          action: 'compress',
          compressionRatio: '70%',
          duration: 4000,
        }));
      }
    }
    
    return {
      message: `成功添加 ${taskCount} 个任务到各个队列`,
      totalTasks: taskCount,
      queuesUsed: ['default', 'high-priority', 'email', 'file-processing'],
      jobIds: results.map(job => job.id),
    };
  }

  // ==============================================
  //      Legacy High-Priority Queue Endpoints
  // ==============================================

  /**
   * 添加任务到高优先级队列 (兼容旧接口)
   */
  @Post('tasks/high-priority')
  async addHighPriorityTask(@Body() task: Task) {
    return this.appService.addHighPriorityTask(task);
  }

  /**
   * 获取高优先级队列状态 (兼容旧接口)
   */
  @Get('queue/stats/high-priority')
  async getHighPriorityQueueStats() {
    return this.appService.getHighPriorityQueueStats();
  }
}