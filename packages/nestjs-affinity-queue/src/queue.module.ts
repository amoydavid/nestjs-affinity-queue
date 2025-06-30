import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { SchedulerProcessor } from './scheduler/scheduler.processor';
import { WorkerService } from './worker/worker.service';
import { queueConfig } from './config/config';

export interface QueueModuleOptions {
  /**
   * 应用角色：调度器或工作节点
   */
  role: 'SCHEDULER' | 'WORKER' | 'BOTH';
  
  /**
   * Worker 配置选项
   */
  workerOptions?: {
    maxBatchSize?: number;
    workerCount?: number;
  };
}

@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    const { role, workerOptions = {} } = options;
    const { maxBatchSize = 10, workerCount = 1 } = workerOptions;

    const imports = [
      ConfigModule.forFeature(queueConfig),
      // 始终导入 BullModule 根配置
      BullModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          connection: {
            host: configService.get<string>('queue.redisHost'),
            port: configService.get<number>('queue.redisPort'),
          },
        }),
        inject: [ConfigService],
      }),
    ];

    const providers: any[] = [QueueService];
    const exportsList: any[] = [QueueService];

    // 根据角色添加不同的模块
    if (role === 'SCHEDULER' || role === 'BOTH') {
      imports.push(
        BullModule.registerQueue({
          name: 'pending-tasks',
        })
      );
      providers.push(SchedulerProcessor);
    }

    if (role === 'WORKER' || role === 'BOTH') {
      providers.push(WorkerService);
      exportsList.push(WorkerService);
    }

    return {
      module: QueueModule,
      imports,
      providers: [
        ...providers,
        {
          provide: 'QUEUE_ROLE',
          useValue: role,
        },
        {
          provide: 'WORKER_OPTIONS',
          useValue: { maxBatchSize, workerCount },
        },
      ],
      exports: exportsList,
      global: true,
    };
  }
} 