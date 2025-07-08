import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { 
  QueueService, 
  WorkerService, 
  QueueModule,
  Task 
} from 'nestjs-affinity-queue';

@Injectable()
export class MultiQueueService implements OnModuleInit {
  constructor(
    // 默认队列服务
    private readonly defaultQueueService: QueueService,
    private readonly defaultWorkerService: WorkerService,

    // 高优先级队列服务
    @Inject(QueueModule.getQueueService('high-priority'))
    private readonly highPriorityQueueService: QueueService,
    
    @Inject(QueueModule.getWorkerService('high-priority'))
    private readonly highPriorityWorkerService: WorkerService,

    // 邮件队列服务
    @Inject(QueueModule.getQueueService('email-queue'))
    private readonly emailQueueService: QueueService,
    
    @Inject(QueueModule.getWorkerService('email-queue'))
    private readonly emailWorkerService: WorkerService,

    // 文件处理队列服务
    @Inject(QueueModule.getQueueService('file-processing'))
    private readonly fileProcessingQueueService: QueueService,
    
    @Inject(QueueModule.getWorkerService('file-processing'))
    private readonly fileProcessingWorkerService: WorkerService,
  ) {}

  async onModuleInit() {
    // 注册默认队列的任务处理器
    this.defaultWorkerService.registerHandler('default-task', async (payload) => {
      console.log(`🔄 默认队列处理任务:`, payload);
      await this.simulateWork(payload.duration || 1000);
      return { success: true, processedBy: 'default-queue', result: payload };
    });

    // 注册高优先级队列的任务处理器
    this.highPriorityWorkerService.registerHandler('urgent-task', async (payload) => {
      console.log(`🚨 高优先级队列处理紧急任务:`, payload);
      await this.simulateWork(payload.duration || 500);
      return { success: true, processedBy: 'high-priority-queue', result: payload };
    });

    this.highPriorityWorkerService.registerHandler('critical-task', async (payload) => {
      console.log(`💥 高优先级队列处理关键任务:`, payload);
      await this.simulateWork(payload.duration || 300);
      return { success: true, processedBy: 'high-priority-queue', result: payload };
    });

    // 注册邮件队列的任务处理器
    this.emailWorkerService.registerHandler('send-email', async (payload) => {
      console.log(`📧 邮件队列发送邮件:`, payload);
      await this.simulateWork(payload.duration || 2000);
      return { 
        success: true, 
        processedBy: 'email-queue', 
        emailSent: true,
        recipient: payload.recipient 
      };
    });

    this.emailWorkerService.registerHandler('send-newsletter', async (payload) => {
      console.log(`📰 邮件队列发送邮件简报:`, payload);
      await this.simulateWork(payload.duration || 3000);
      return { 
        success: true, 
        processedBy: 'email-queue', 
        newsletterSent: true,
        subscriberCount: payload.subscriberCount 
      };
    });

    // 注册文件处理队列的任务处理器
    this.fileProcessingWorkerService.registerHandler('process-file', async (payload) => {
      console.log(`📄 文件处理队列处理文件:`, payload);
      await this.simulateWork(payload.duration || 5000);
      return { 
        success: true, 
        processedBy: 'file-processing-queue', 
        fileProcessed: true,
        fileName: payload.fileName 
      };
    });

    this.fileProcessingWorkerService.registerHandler('compress-file', async (payload) => {
      console.log(`🗜️ 文件处理队列压缩文件:`, payload);
      await this.simulateWork(payload.duration || 4000);
      return { 
        success: true, 
        processedBy: 'file-processing-queue', 
        fileCompressed: true,
        fileName: payload.fileName,
        compressionRatio: payload.compressionRatio || '70%'
      };
    });

    console.log(`✅ 多队列服务已初始化，所有任务处理器已注册`);
  }

  // 添加默认任务
  async addDefaultTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'default-task',
      identifyTag,
      payload,
    };
    return await this.defaultQueueService.add(task);
  }

  // 添加高优先级任务
  async addUrgentTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'urgent-task',
      identifyTag,
      payload,
    };
    return await this.highPriorityQueueService.add(task);
  }

  async addCriticalTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'critical-task',
      identifyTag,
      payload,
    };
    return await this.highPriorityQueueService.add(task);
  }

  // 添加邮件任务
  async addEmailTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'send-email',
      identifyTag,
      payload,
    };
    return await this.emailQueueService.add(task);
  }

  async addNewsletterTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'send-newsletter',
      identifyTag,
      payload,
    };
    return await this.emailQueueService.add(task);
  }

  // 添加文件处理任务
  async addFileProcessingTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'process-file',
      identifyTag,
      payload,
    };
    return await this.fileProcessingQueueService.add(task);
  }

  async addFileCompressionTask(identifyTag: string, payload: any): Promise<any> {
    const task: Task = {
      type: 'compress-file',
      identifyTag,
      payload,
    };
    return await this.fileProcessingQueueService.add(task);
  }

  // 获取所有队列状态
  async getAllQueueStats() {
    const [
      defaultStats,
      highPriorityStats,
      emailStats,
      fileProcessingStats
    ] = await Promise.all([
      this.defaultQueueService.getQueueStats(),
      this.highPriorityQueueService.getQueueStats(),
      this.emailQueueService.getQueueStats(),
      this.fileProcessingQueueService.getQueueStats(),
    ]);

    return {
      defaultQueue: defaultStats,
      highPriorityQueue: highPriorityStats,
      emailQueue: emailStats,
      fileProcessingQueue: fileProcessingStats,
    };
  }

  // 模拟工作延迟
  private async simulateWork(duration: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, duration));
  }
}