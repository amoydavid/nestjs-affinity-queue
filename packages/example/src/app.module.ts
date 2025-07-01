import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaskHandlerService } from './task-handler.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
        // 自定义队列前缀，支持多实例隔离
        pendingQueueName: process.env.PENDING_QUEUE_NAME || 'my-app-pending-tasks',
        workerQueuePrefix: process.env.WORKER_QUEUE_PREFIX || 'my-app-worker-queue',
        workerStatePrefix: process.env.WORKER_STATE_PREFIX || 'my-app-worker-state',
        schedulerInterval: parseInt(process.env.SCHEDULER_INTERVAL || '1000', 10),
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, TaskHandlerService],
})
export class AppModule {
  constructor() {
    const role = process.env.APP_ROLE || 'BOTH';
    console.log(`🚀 应用启动，角色: ${role}`);
  }
} 