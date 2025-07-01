import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { SchedulerProcessor } from './scheduler/scheduler.processor';
import { SchedulerElectionService } from './scheduler/scheduler.election';
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

  /**
   * Redis 配置选项
   */
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };

  /**
   * 队列配置选项
   */
  queueOptions?: {
    /**
     * 待处理任务队列名称
     */
    pendingQueueName?: string;
    /**
     * Worker 队列前缀
     */
    workerQueuePrefix?: string;
    /**
     * Worker 状态前缀
     */
    workerStatePrefix?: string;
    /**
     * 调度器间隔（毫秒）
     */
    schedulerInterval?: number;
  };

  /**
   * 选举配置选项
   */
  electionOptions?: {
    /**
     * 选举锁的过期时间（毫秒）
     */
    electionLockTtl?: number;
    /**
     * 心跳间隔（毫秒）
     */
    heartbeatInterval?: number;
    /**
     * 心跳超时时间（毫秒）
     */
    heartbeatTimeout?: number;
  };
}

@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    const { role, workerOptions = {}, redisOptions = {}, queueOptions = {}, electionOptions = {} } = options;
    const { maxBatchSize = 10, workerCount = 1 } = workerOptions;
    const { 
      host = 'localhost', 
      port = 6379, 
      password, 
      db = 0 
    } = redisOptions;
    const {
      pendingQueueName = 'pending-tasks',
      workerQueuePrefix = 'worker-queue',
      workerStatePrefix = 'worker-state',
      schedulerInterval = 1000,
    } = queueOptions;

    // 设置全局队列选项，供配置模块使用
    (global as any).__QUEUE_MODULE_OPTIONS__ = {
      pendingQueueName,
      workerQueuePrefix,
      workerStatePrefix,
      schedulerInterval,
    };

    const imports = [
      ConfigModule.forFeature(queueConfig),
      // 始终导入 BullModule 根配置
      BullModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => {
          // 优先使用外部配置的 Redis 参数，如果没有则使用环境变量
          const redisHost = host || configService.get<string>('queue.redisHost');
          const redisPort = port || configService.get<number>('queue.redisPort');
          
          const connection: any = {
            host: redisHost,
            port: redisPort,
          };

          // 只有当密码存在时才添加到连接配置中
          if (password) {
            connection.password = password;
          }

          // 只有当 db 存在且不为 0 时才添加到连接配置中
          if (db !== undefined && db !== 0) {
            connection.db = db;
          }

          return { connection };
        },
        inject: [ConfigService],
      }),
    ];

    const providers: any[] = [];
    const exportsList: any[] = [];

    // 选举服务在所有模式下都需要
    providers.push(SchedulerElectionService);
    providers.push({
      provide: 'ELECTION_OPTIONS',
      useValue: electionOptions,
    });

    // 根据角色添加不同的服务和模块
    if (role === 'SCHEDULER' || role === 'BOTH') {
      providers.push(SchedulerProcessor);
    }

    if (role === 'WORKER' || role === 'BOTH') {
      providers.push(WorkerService);
      exportsList.push(WorkerService);
    }

    // QueueService 在所有模式下都需要，因为需要添加任务
    providers.push(QueueService);
    exportsList.push(QueueService);

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
        {
          provide: 'REDIS_OPTIONS',
          useValue: { host, port, password, db },
        },
        {
          provide: 'QUEUE_OPTIONS',
          useValue: { pendingQueueName, workerQueuePrefix, workerStatePrefix, schedulerInterval },
        },
      ],
      exports: exportsList,
      global: true,
    };
  }
} 