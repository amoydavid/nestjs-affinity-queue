import { Module, DynamicModule, Provider } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { QueueService } from './queue.service';
import { SchedulerProcessor } from './scheduler/scheduler.processor';
import { SchedulerElectionService } from './scheduler/scheduler.election';
import { WorkerService } from './worker/worker.service';
import { RedisConnectionManager } from './common/redis-connection.manager';
import { queueConfig } from './config/config';

// Token 生成函数
export const getQueueOptionsToken = (name: string): string => `QUEUE_OPTIONS_${name.toUpperCase()}`;
export const getQueueServiceToken = (name: string): string => `QUEUE_SERVICE_${name.toUpperCase()}`;
export const getWorkerServiceToken = (name: string): string => `WORKER_SERVICE_${name.toUpperCase()}`;
export const getSchedulerProcessorToken = (name: string): string => `SCHEDULER_PROCESSOR_${name.toUpperCase()}`;

// 默认队列名称常量
export const DEFAULT_QUEUE_NAME = 'default';
export const DEFAULT_PENDING_QUEUE_NAME = 'pending-tasks';

export interface QueueModuleOptions {
  name?: string;
  role: 'SCHEDULER' | 'WORKER' | 'BOTH';
  workerOptions?: {
    maxBatchSize?: number;
    workerCount?: number;
  };
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };
  queueOptions?: {
    pendingQueueName?: string;
    workerQueuePrefix?: string;
    workerStatePrefix?: string;
    schedulerInterval?: number;
  };
  electionOptions?: {
    electionLockTtl?: number;
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
  };
}

export interface QueueModuleFeatureOptions {
  name: string;
  role: 'SCHEDULER' | 'WORKER' | 'BOTH';
  workerOptions?: {
    maxBatchSize?: number;
    workerCount?: number;
  };
  redisOptions?: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };
  queueOptions: {
    pendingQueueName: string;
    workerQueuePrefix?: string;
    workerStatePrefix?: string;
    schedulerInterval?: number;
  };
  electionOptions?: {
    electionLockTtl?: number;
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
  };
}

export interface QueueModuleAsyncOptions {
  useFactory: (...args: any[]) => Promise<QueueModuleOptions> | QueueModuleOptions;
  inject?: any[];
  imports?: any[];
}

export interface QueueModuleFeatureAsyncOptions {
  useFactory: (...args: any[]) => Promise<QueueModuleFeatureOptions> | QueueModuleFeatureOptions;
  inject?: any[];
  imports?: any[];
}

const createDefaultProviders = (options: QueueModuleOptions): Provider[] => {
  const { role, queueOptions = {} } = options;
  const { pendingQueueName = DEFAULT_PENDING_QUEUE_NAME } = queueOptions;
  const queueName = options.name || DEFAULT_QUEUE_NAME;

  const providers: Provider[] = [];

  // The options provider is used by all services
  providers.push({
    provide: 'QUEUE_OPTIONS',
    useValue: { ...options, name: queueName },
  });

  // Redis 连接管理器
  providers.push(RedisConnectionManager);

  // 创建共享的 Redis 连接
  providers.push({
    provide: 'SHARED_REDIS_CONNECTION',
    useFactory: (redisOptions: any, manager: RedisConnectionManager) => {
      return manager.getConnection(queueName, redisOptions);
    },
    inject: ['REDIS_OPTIONS', RedisConnectionManager],
  });

  // Create queue-specific election service
  providers.push({
    provide: SchedulerElectionService,
    useFactory: (electionOptions: any, sharedRedis: Redis) => {
      return new SchedulerElectionService(
        { ...electionOptions, queueName },
        sharedRedis
      );
    },
    inject: ['ELECTION_OPTIONS', 'SHARED_REDIS_CONNECTION'],
  });

  // QueueService is always needed
  providers.push({
    provide: QueueService,
    useFactory: (opts: QueueModuleOptions, queue: any) => new QueueService(opts, queue),
    inject: ['QUEUE_OPTIONS', getQueueToken(pendingQueueName)],
  });

  // WorkerService is needed for WORKER or BOTH roles
  if (role === 'WORKER' || role === 'BOTH') {
    providers.push({
      provide: WorkerService,
      useFactory: (opts: QueueModuleOptions, electionService: SchedulerElectionService) => new WorkerService(opts, electionService),
      inject: ['QUEUE_OPTIONS', SchedulerElectionService],
    });
  }

  // SchedulerProcessor is needed for SCHEDULER or BOTH roles
  if (role === 'SCHEDULER' || role === 'BOTH') {
    providers.push({
      provide: SchedulerProcessor,
      useFactory: (opts: QueueModuleOptions, queue: any, electionService: SchedulerElectionService) => new SchedulerProcessor(opts, queue, electionService),
      inject: ['QUEUE_OPTIONS', getQueueToken(pendingQueueName), SchedulerElectionService],
    });
  }

  return providers;
};

const createFeatureProviders = (options: QueueModuleFeatureOptions): { providers: Provider[], exports: any[] } => {
  const { name, role, queueOptions, electionOptions = {} } = options;
  const { pendingQueueName } = queueOptions;

  const providers: Provider[] = [];
  const exportsList: any[] = [];

  // Options provider for this specific queue
  const optionsToken = getQueueOptionsToken(name);
  providers.push({ 
    provide: optionsToken, 
    useValue: options 
  });

  // Create queue-specific election service
  const electionServiceToken = `SCHEDULER_ELECTION_SERVICE_${name.toUpperCase()}`;
  providers.push({
    provide: electionServiceToken,
    useFactory: (opts: QueueModuleFeatureOptions, redisManager: RedisConnectionManager) => {
      // 使用共享的 Redis 连接管理器
      const redisConnection = redisManager.getConnection(name, opts.redisOptions || {
        host: 'localhost',
        port: 6379,
        db: 0
      });
      
      return new SchedulerElectionService(
        { ...electionOptions, queueName: name },
        redisConnection
      );
    },
    inject: [optionsToken, RedisConnectionManager],
  });

  // QueueService for this specific queue
  const queueServiceToken = getQueueServiceToken(name);
  providers.push({
    provide: queueServiceToken,
    useFactory: (opts: QueueModuleFeatureOptions, queue: any) => new QueueService(opts, queue),
    inject: [optionsToken, getQueueToken(pendingQueueName)],
  });
  exportsList.push(queueServiceToken);

  // WorkerService for this specific queue (if needed)
  if (role === 'WORKER' || role === 'BOTH') {
    const workerServiceToken = getWorkerServiceToken(name);
    providers.push({
      provide: workerServiceToken,
      useFactory: (opts: QueueModuleFeatureOptions, electionService: SchedulerElectionService) => new WorkerService(opts, electionService),
      inject: [optionsToken, electionServiceToken],
    });
    exportsList.push(workerServiceToken);
  }

  // SchedulerProcessor for this specific queue (if needed)
  if (role === 'SCHEDULER' || role === 'BOTH') {
    const schedulerProcessorToken = getSchedulerProcessorToken(name);
    providers.push({
      provide: schedulerProcessorToken,
      useFactory: (opts: QueueModuleFeatureOptions, queue: any, electionService: SchedulerElectionService) => new SchedulerProcessor(opts, queue, electionService),
      inject: [optionsToken, getQueueToken(pendingQueueName), electionServiceToken],
    });
    // Note: Schedulers are typically internal and not exported
  }

  return { providers, exports: exportsList };
};

@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    const { redisOptions = {}, queueOptions = {}, electionOptions = {} } = options;
    const { 
      host = 'localhost', 
      port = 6379, 
      password, 
      db = 0 
    } = redisOptions;
    const { pendingQueueName = DEFAULT_PENDING_QUEUE_NAME } = queueOptions;

    // Set a global option for backward compatibility with the config module
    (global as any).__QUEUE_MODULE_OPTIONS__ = queueOptions;

    const defaultProviders = createDefaultProviders(options);

    return {
      module: QueueModule,
      imports: [
        ConfigModule.forFeature(queueConfig),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            connection: {
              host: host || configService.get<string>('queue.redisHost'),
              port: port || configService.get<number>('queue.redisPort'),
              password: password,
              db: db,
              maxRetriesPerRequest: null,
            },
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue({ name: pendingQueueName }),
      ],
      providers: [
        {
          provide: 'ELECTION_OPTIONS',
          useValue: electionOptions,
        },
        {
          provide: 'REDIS_OPTIONS',
          useValue: { host, port, password, db },
        },
        ...defaultProviders,
      ],
      exports: [QueueService, WorkerService],
      global: true,
    };
  }

  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        ...(options.imports || []),
        ConfigModule.forFeature(queueConfig),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService, ...args: any[]) => {
            const queueOptions = await options.useFactory(...args);
            const { redisOptions = {} } = queueOptions;
            const { 
              host = 'localhost', 
              port = 6379, 
              password, 
              db = 0 
            } = redisOptions;
            
            return {
              connection: {
                host: host || configService.get<string>('queue.redisHost'),
                port: port || configService.get<number>('queue.redisPort'),
                password: password,
                db: db,
                maxRetriesPerRequest: null,
              },
            };
          },
          inject: [ConfigService, ...(options.inject || [])],
        }),
        BullModule.registerQueue({ name: DEFAULT_PENDING_QUEUE_NAME }),
      ],
      providers: [
        {
          provide: 'QUEUE_OPTIONS_FACTORY',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: 'QUEUE_OPTIONS',
          useFactory: (options: QueueModuleOptions) => ({ 
            ...options, 
            name: options.name || DEFAULT_QUEUE_NAME 
          }),
          inject: ['QUEUE_OPTIONS_FACTORY'],
        },
        {
          provide: 'ELECTION_OPTIONS',
          useFactory: (options: QueueModuleOptions) => options.electionOptions || {},
          inject: ['QUEUE_OPTIONS_FACTORY'],
        },
        {
          provide: 'REDIS_OPTIONS',
          useFactory: (options: QueueModuleOptions) => {
            const { redisOptions = {} } = options;
            const { 
              host = 'localhost', 
              port = 6379, 
              password, 
              db = 0 
            } = redisOptions;
            return { host, port, password, db };
          },
          inject: ['QUEUE_OPTIONS_FACTORY'],
        },
        // Redis 连接管理器
        RedisConnectionManager,
        // 创建共享的 Redis 连接
        {
          provide: 'SHARED_REDIS_CONNECTION',
          useFactory: (redisOptions: any, manager: RedisConnectionManager) => {
            return manager.getConnection('default', redisOptions);
          },
          inject: ['REDIS_OPTIONS', RedisConnectionManager],
        },
        // 使用 createDefaultProviders 避免重复注册，但需要修改注入依赖
        {
          provide: SchedulerElectionService,
          useFactory: (electionOptions: any, sharedRedis: Redis) => {
            return new SchedulerElectionService(electionOptions, sharedRedis);
          },
          inject: ['ELECTION_OPTIONS', 'SHARED_REDIS_CONNECTION'],
        },
        {
          provide: QueueService,
          useFactory: (opts: QueueModuleOptions, queue: any) => new QueueService(opts, queue),
          inject: ['QUEUE_OPTIONS', getQueueToken(DEFAULT_PENDING_QUEUE_NAME)],
        },
        {
          provide: WorkerService,
          useFactory: (opts: QueueModuleOptions, electionService: SchedulerElectionService) => {
            if (opts.role === 'WORKER' || opts.role === 'BOTH') {
              return new WorkerService(opts, electionService);
            }
            return null;
          },
          inject: ['QUEUE_OPTIONS', SchedulerElectionService],
        },
        {
          provide: SchedulerProcessor,
          useFactory: (opts: QueueModuleOptions, queue: any, electionService: SchedulerElectionService) => {
            if (opts.role === 'SCHEDULER' || opts.role === 'BOTH') {
              return new SchedulerProcessor(opts, queue, electionService);
            }
            return null;
          },
          inject: ['QUEUE_OPTIONS', getQueueToken(DEFAULT_PENDING_QUEUE_NAME), SchedulerElectionService],
        },
      ],
      exports: [QueueService, WorkerService],
      global: true,
    };
  }

  static forFeature(options: QueueModuleFeatureOptions): DynamicModule {
    const { name, queueOptions } = options;
    const { pendingQueueName } = queueOptions;

    if (!name) {
      throw new Error('QueueModule.forFeature() requires a "name" property in the options.');
    }
    if (!pendingQueueName) {
      throw new Error('QueueModule.forFeature() requires a "pendingQueueName" in the queueOptions.');
    }

    const { providers, exports: exportsList } = createFeatureProviders(options);

    return {
      module: QueueModule,
      imports: [BullModule.registerQueue({ name: pendingQueueName })],
      providers: [
        RedisConnectionManager, // 确保 RedisConnectionManager 可用
        ...providers,
      ],
      exports: exportsList,
    };
  }

  static forFeatureAsync(name: string, options: QueueModuleFeatureAsyncOptions): DynamicModule {
    if (!name) {
      throw new Error('QueueModule.forFeatureAsync() requires a "name" parameter.');
    }

    const electionServiceToken = `SCHEDULER_ELECTION_SERVICE_${name.toUpperCase()}`;

    return {
      module: QueueModule,
      imports: [
        ...(options.imports || []),
      ],
      providers: [
        RedisConnectionManager, // 确保 RedisConnectionManager 可用
        {
          provide: getQueueOptionsToken(name),
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: electionServiceToken,
          useFactory: (opts: QueueModuleFeatureOptions, redisManager: RedisConnectionManager) => {
            // 使用共享的 Redis 连接管理器
            const redisConnection = redisManager.getConnection(name, opts.redisOptions || {
              host: 'localhost',
              port: 6379,
              db: 0
            });
            
            return new SchedulerElectionService(
              { ...opts.electionOptions, queueName: name },
              redisConnection
            );
          },
          inject: [getQueueOptionsToken(name), RedisConnectionManager],
        },
        {
          provide: getQueueServiceToken(name),
          useFactory: async (opts: QueueModuleFeatureOptions, electionService: SchedulerElectionService) => {
            // 在运行时创建队列和服务，使用队列特定的 Redis 连接
            const { Queue } = await import('bullmq');
            const redis = electionService.getRedisClient();
            const queue = new Queue(opts.queueOptions.pendingQueueName, { connection: redis });
            return new QueueService(opts, queue);
          },
          inject: [getQueueOptionsToken(name), electionServiceToken],
        },
        {
          provide: getWorkerServiceToken(name),
          useFactory: async (opts: QueueModuleFeatureOptions, electionService: SchedulerElectionService) => {
            if (opts.role === 'WORKER' || opts.role === 'BOTH') {
              return new WorkerService(opts, electionService);
            }
            return null;
          },
          inject: [getQueueOptionsToken(name), electionServiceToken],
        },
        {
          provide: getSchedulerProcessorToken(name),
          useFactory: async (opts: QueueModuleFeatureOptions, electionService: SchedulerElectionService) => {
            if (opts.role === 'SCHEDULER' || opts.role === 'BOTH') {
              // 在运行时创建队列和调度器，使用队列特定的 Redis 连接
              const { Queue } = await import('bullmq');
              const redis = electionService.getRedisClient();
              const queue = new Queue(opts.queueOptions.pendingQueueName, { connection: redis });
              return new SchedulerProcessor(opts, queue, electionService);
            }
            return null;
          },
          inject: [getQueueOptionsToken(name), electionServiceToken],
        },
      ],
      exports: [
        getQueueServiceToken(name),
        getWorkerServiceToken(name),
      ],
    };
  }

  /**
   * 获取指定名称的队列服务实例
   * 用于在应用中注入特定的队列服务
   */
  static getQueueService(name: string): string {
    return getQueueServiceToken(name);
  }

  /**
   * 获取指定名称的工作器服务实例
   * 用于在应用中注入特定的工作器服务
   */
  static getWorkerService(name: string): string {
    return getWorkerServiceToken(name);
  }

  /**
   * 获取指定名称的调度器处理器实例
   * 用于在应用中注入特定的调度器处理器
   */
  static getSchedulerProcessor(name: string): string {
    return getSchedulerProcessorToken(name);
  }
}
