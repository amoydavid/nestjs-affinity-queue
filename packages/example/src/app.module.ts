import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaskHandlerService } from './task-handler.service';
import { ElectionTestService } from './election-test.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // 同步配置示例
    QueueModule.forRoot({
      role: (process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH') || 'BOTH',
      workerOptions: {
        maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '5', 10),
      },
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
      },
      queueOptions: {
        pendingQueueName: process.env.PENDING_QUEUE_NAME || 'pending-tasks',
        workerQueuePrefix: process.env.WORKER_QUEUE_PREFIX || 'worker-queue',
        workerStatePrefix: process.env.WORKER_STATE_PREFIX || 'worker-state',
        schedulerInterval: parseInt(process.env.SCHEDULER_INTERVAL || '1000', 10),
      },
      electionOptions: {
        electionLockTtl: parseInt(process.env.ELECTION_LOCK_TTL || '30000', 10),
        heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '10000', 10),
        heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT || '60000', 10),
      },
    }),
    // 异步配置示例（注释掉以避免冲突）
    /*
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        role: configService.get('APP_ROLE', 'BOTH') as 'SCHEDULER' | 'WORKER' | 'BOTH',
        workerOptions: {
          maxBatchSize: configService.get('QUEUE_MAX_BATCH_SIZE', 10),
          workerCount: configService.get('QUEUE_WORKER_COUNT', 2),
        },
        redisOptions: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
        },
        queueOptions: {
          pendingQueueName: configService.get('QUEUE_PENDING_NAME', 'pending-tasks'),
          workerQueuePrefix: configService.get('QUEUE_WORKER_PREFIX', 'worker-'),
          schedulerInterval: configService.get('QUEUE_SCHEDULER_INTERVAL', 1000),
        },
        electionOptions: {
          electionLockTtl: configService.get('ELECTION_LOCK_TTL', 30000),
          heartbeatInterval: configService.get('ELECTION_HEARTBEAT_INTERVAL', 5000),
          heartbeatTimeout: configService.get('ELECTION_HEARTBEAT_TIMEOUT', 15000),
        },
      }),
      inject: [ConfigService],
    }),
    */
    // 多队列配置演示
    QueueModule.forFeature({
      name: 'high-priority',
      role: 'BOTH',
      workerOptions: {
        maxBatchSize: 10,
        workerCount: 1,
      },
      redisOptions: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0', 10),
      },
      queueOptions: {
        pendingQueueName: 'high-app-pending-tasks',
        workerQueuePrefix: 'high-app-worker-queue',
        workerStatePrefix: 'high-app-worker-state',
        schedulerInterval: 1000,
      },
      electionOptions: {
        electionLockTtl: 30000,
        heartbeatInterval: 10000,
        heartbeatTimeout: 60000,
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, TaskHandlerService, ElectionTestService],
})
export class AppModule {
  constructor() {
    const role = process.env.APP_ROLE || 'BOTH';
    console.log(`🚀 应用启动，角色: ${role}`);
  }
} 