import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { QueueModule, QueueService } from 'nestjs-affinity-queue';

@Injectable()
export class ElectionTestService implements OnModuleInit {
  private readonly logger = new Logger(ElectionTestService.name);

  constructor(
    private readonly defaultQueueService: QueueService, // Default queue service from forRoot
    @Inject(QueueModule.getQueueService('high-priority'))
    private readonly highPriorityQueueService: any,
    @Inject(QueueModule.getQueueService('email-queue'))
    private readonly emailQueueService: any,
    @Inject(QueueModule.getQueueService('file-processing'))
    private readonly fileProcessingQueueService: any,
  ) {}

  async onModuleInit() {
    // 等待服务初始化
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    this.logger.log('=== 多队列选举测试服务启动 ===');
    this.logger.log('📊 监控所有队列的选举状态');
    
    // 定期输出所有队列的状态信息
    setInterval(async () => {
      await this.logAllQueuesStatus();
    }, 15000);

    // 立即输出一次状态
    await this.logAllQueuesStatus();
  }

  private async logAllQueuesStatus() {
    this.logger.log('=== 队列状态更新 ===');
    
    const queues = [
      { name: 'default', service: this.defaultQueueService },
      { name: 'high-priority', service: this.highPriorityQueueService },
      { name: 'email-queue', service: this.emailQueueService },
      { name: 'file-processing', service: this.fileProcessingQueueService },
    ];

    for (const queue of queues) {
      try {
        const stats = await queue.service.getQueueStats();
        this.logger.log(`📋 ${queue.name}: waiting=${stats.waiting}, active=${stats.active}, completed=${stats.completed}, failed=${stats.failed}`);
      } catch (error: any) {
        this.logger.error(`❌ ${queue.name}: 获取状态失败 - ${error.message}`);
      }
    }
    
    this.logger.log('=== 状态更新完成 ===');
  }
} 