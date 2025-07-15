import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaskHandlerService } from './task-handler.service';
import { ElectionTestService } from './election-test.service';
import { MultiQueueService } from './multi-queue.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    // 全局默认队列配置
    QueueModule.forRoot({
      role: (process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH') || 'BOTH',
      workerOptions: {
        maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '5', 10),
        workerCount: parseInt(process.env.WORKER_COUNT || '2', 10),
      },
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
      },
      queueOptions: {
        pendingQueueName: process.env.PENDING_QUEUE_NAME || 'default-pending-tasks',
        workerQueuePrefix: process.env.WORKER_QUEUE_PREFIX || 'default-worker-queue',
        workerStatePrefix: process.env.WORKER_STATE_PREFIX || 'default-worker-state',
        schedulerInterval: parseInt(process.env.SCHEDULER_INTERVAL || '1000', 10),
        // identifyTag 并发数配置示例
        identifyTagConcurrency: {
          default: 1,           // 默认每个 identifyTag 最多 1 个 worker
          'high-priority': 3,   // high-priority 标签最多 3 个 worker
          'batch-process': 2,   // batch-process 标签最多 2 个 worker
          'single-task': 1,     // single-task 标签最多 1 个 worker
        },
      },
      electionOptions: {
        electionLockTtl: parseInt(process.env.ELECTION_LOCK_TTL || '30000', 10),
        heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '10000', 10),
        heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT || '60000', 10),
      },
    }),

    // 高优先级队列配置 (forFeature 演示)
    QueueModule.forFeature({
      name: 'high-priority',
      role: (process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH') || 'BOTH',
      workerOptions: {
        maxBatchSize: parseInt(process.env.HIGH_PRIORITY_BATCH_SIZE || '3', 10),
        workerCount: parseInt(process.env.HIGH_PRIORITY_WORKER_COUNT || '1', 10),
      },
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
      },
      queueOptions: {
        pendingQueueName: 'high-priority-pending-tasks',
        workerQueuePrefix: 'high-priority-worker-queue',
        workerStatePrefix: 'high-priority-worker-state',
        schedulerInterval: parseInt(process.env.HIGH_PRIORITY_SCHEDULER_INTERVAL || '500', 10),
      },
      electionOptions: {
        electionLockTtl: parseInt(process.env.HIGH_PRIORITY_ELECTION_LOCK_TTL || '30000', 10),
        heartbeatInterval: parseInt(process.env.HIGH_PRIORITY_HEARTBEAT_INTERVAL || '5000', 10),
        heartbeatTimeout: parseInt(process.env.HIGH_PRIORITY_HEARTBEAT_TIMEOUT || '30000', 10),
      },
    }),

    // 邮件队列配置 (forFeatureAsync 演示)
    QueueModule.forFeatureAsync('email-queue', {
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        name: 'email-queue',
        role: configService.get('APP_ROLE', 'BOTH') as 'SCHEDULER' | 'WORKER' | 'BOTH',
        workerOptions: {
          maxBatchSize: configService.get('EMAIL_BATCH_SIZE', 2),
          workerCount: configService.get('EMAIL_WORKER_COUNT', 1),
        },
        redisOptions: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
        },
        queueOptions: {
          pendingQueueName: configService.get('EMAIL_QUEUE_NAME', 'email-pending-tasks'),
          workerQueuePrefix: configService.get('EMAIL_WORKER_PREFIX', 'email-worker-queue'),
          workerStatePrefix: configService.get('EMAIL_WORKER_STATE_PREFIX', 'email-worker-state'),
          schedulerInterval: configService.get('EMAIL_SCHEDULER_INTERVAL', 2000),
        },
        electionOptions: {
          electionLockTtl: configService.get('EMAIL_ELECTION_LOCK_TTL', 60000),
          heartbeatInterval: configService.get('EMAIL_HEARTBEAT_INTERVAL', 10000),
          heartbeatTimeout: configService.get('EMAIL_HEARTBEAT_TIMEOUT', 60000),
        },
      }),
      inject: [ConfigService],
    }),

    // 文件处理队列配置
    QueueModule.forFeature({
      name: 'file-processing',
      role: (process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH') || 'BOTH',
      workerOptions: {
        maxBatchSize: parseInt(process.env.FILE_PROCESSING_BATCH_SIZE || '1', 10),
        workerCount: parseInt(process.env.FILE_PROCESSING_WORKER_COUNT || '1', 10),
      },
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
      },
      queueOptions: {
        pendingQueueName: 'file-processing-pending-tasks',
        workerQueuePrefix: 'file-processing-worker-queue',
        workerStatePrefix: 'file-processing-worker-state',
        schedulerInterval: parseInt(process.env.FILE_PROCESSING_SCHEDULER_INTERVAL || '3000', 10),
      },
      electionOptions: {
        electionLockTtl: parseInt(process.env.FILE_PROCESSING_ELECTION_LOCK_TTL || '90000', 10),
        heartbeatInterval: parseInt(process.env.FILE_PROCESSING_HEARTBEAT_INTERVAL || '15000', 10),
        heartbeatTimeout: parseInt(process.env.FILE_PROCESSING_HEARTBEAT_TIMEOUT || '90000', 10),
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, TaskHandlerService, ElectionTestService, MultiQueueService],
})
export class AppModule {
  constructor() {
    const role = process.env.APP_ROLE || 'BOTH';
    console.log(`🚀 应用启动，角色: ${role}`);
    console.log(`📋 已配置队列：`);
    console.log(`   - 默认队列 (default-pending-tasks)`);
    console.log(`   - 高优先级队列 (high-priority-pending-tasks)`);
    console.log(`   - 邮件队列 (email-pending-tasks)`);
    console.log(`   - 文件处理队列 (file-processing-pending-tasks)`);
  }
} 