import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { WorkerService } from 'nestjs-affinity-queue';

@Injectable()
export class TaskHandlerService implements OnModuleInit {
  private readonly logger = new Logger(TaskHandlerService.name);

  constructor(@Inject(WorkerService) private readonly workerService: WorkerService) {}

  async onModuleInit() {
    this.registerHandlers(this.workerService);
  }

  /**
   * 注册所有任务处理器
   */
  registerHandlers(workerService: WorkerService): void {
    // 注册发票生成任务处理器
    workerService.registerHandler('generate-invoice', this.handleGenerateInvoice.bind(this));
    
    // 注册邮件发送任务处理器
    workerService.registerHandler('send-email', this.handleSendEmail.bind(this));
    
    // 注册数据处理任务处理器
    workerService.registerHandler('process-data', this.handleProcessData.bind(this));
    
    this.logger.log('所有任务处理器已注册');
  }

  /**
   * 处理发票生成任务
   */
  private async handleGenerateInvoice(payload: any): Promise<any> {
    this.logger.log(`处理发票生成任务: ${JSON.stringify(payload)}`);
    
    // 模拟生成发票的处理时间
    await this.delay(1000 + Math.random() * 2000);
    
    const result = {
      invoiceId: `INV-${Date.now()}`,
      amount: payload.amount || Math.floor(Math.random() * 1000) + 100,
      status: 'generated',
      processedAt: new Date().toISOString(),
      originalPayload: payload,
    };
    
    this.logger.log(`发票生成完成: ${result.invoiceId}`);
    return result;
  }

  /**
   * 处理邮件发送任务
   */
  private async handleSendEmail(payload: any): Promise<any> {
    this.logger.log(`处理邮件发送任务: ${JSON.stringify(payload)}`);
    
    // 模拟发送邮件的处理时间
    await this.delay(500 + Math.random() * 1500);
    
    const result = {
      messageId: `MSG-${Date.now()}`,
      to: payload.to || 'user@example.com',
      subject: payload.subject || '系统通知',
      status: 'sent',
      sentAt: new Date().toISOString(),
      originalPayload: payload,
    };
    
    this.logger.log(`邮件发送完成: ${result.messageId}`);
    return result;
  }

  /**
   * 处理数据处理任务
   */
  private async handleProcessData(payload: any): Promise<any> {
    this.logger.log(`处理数据处理任务: ${JSON.stringify(payload)}`);
    
    // 模拟数据处理的处理时间
    await this.delay(800 + Math.random() * 1200);
    
    const result = {
      processId: `PROC-${Date.now()}`,
      recordsProcessed: payload.recordCount || Math.floor(Math.random() * 100) + 10,
      status: 'completed',
      processedAt: new Date().toISOString(),
      originalPayload: payload,
    };
    
    this.logger.log(`数据处理完成: ${result.processId}`);
    return result;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 