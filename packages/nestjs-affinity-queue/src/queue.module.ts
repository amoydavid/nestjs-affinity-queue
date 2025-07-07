import { Module, DynamicModule, Provider } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { SchedulerProcessor } from './scheduler/scheduler.processor';
import { SchedulerElectionService } from './scheduler/scheduler.election';
import { WorkerService } from './worker/worker.service';
import { queueConfig } from './config/config';

export const getQueueOptionsToken = (name: string): string => `QUEUE_OPTIONS_${name.toUpperCase()}`;
export const getQueueServiceToken = (name: string): string => `QUEUE_SERVICE_${name.toUpperCase()}`;
export const getWorkerServiceToken = (name: string): string => `WORKER_SERVICE_${name.toUpperCase()}`;
export const getSchedulerProcessorToken = (name: string): string => `SCHEDULER_PROCESSOR_${name.toUpperCase()}`;

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

export interface QueueModuleAsyncOptions {
  useFactory: (...args: any[]) => Promise<QueueModuleOptions> | QueueModuleOptions;
  inject?: any[];
  imports?: any[];
}

const createDefaultProviders = (options: QueueModuleOptions): Provider[] => {
  const { role, workerOptions = {}, queueOptions = {} } = options;
  const { pendingQueueName } = queueOptions;

  const providers: Provider[] = [];

  // The options provider is used by all services
  providers.push({
    provide: 'QUEUE_OPTIONS',
    useValue: options,
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
    const { pendingQueueName = 'pending-tasks' } = queueOptions;

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
        SchedulerElectionService,
        ...defaultProviders,
      ],
      exports: [QueueService, WorkerService, SchedulerElectionService],
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
      ],
      providers: [
        {
          provide: 'QUEUE_OPTIONS_FACTORY',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: 'QUEUE_OPTIONS',
          useFactory: (options: QueueModuleOptions) => options,
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
        {
          provide: 'PENDING_QUEUE_NAME',
          useFactory: (options: QueueModuleOptions) => {
            const { queueOptions = {} } = options;
            const { pendingQueueName = 'pending-tasks' } = queueOptions;
            return pendingQueueName;
          },
          inject: ['QUEUE_OPTIONS_FACTORY'],
        },
        SchedulerElectionService,
        {
          provide: QueueService,
          useFactory: (opts: QueueModuleOptions, queue: any) => new QueueService(opts, queue),
          inject: ['QUEUE_OPTIONS', getQueueToken('pending-tasks')],
        },
        {
          provide: WorkerService,
          useFactory: (opts: QueueModuleOptions, electionService: SchedulerElectionService) => new WorkerService(opts, electionService),
          inject: ['QUEUE_OPTIONS', SchedulerElectionService],
        },
        {
          provide: SchedulerProcessor,
          useFactory: (opts: QueueModuleOptions, queue: any, electionService: SchedulerElectionService) => new SchedulerProcessor(opts, queue, electionService),
          inject: ['QUEUE_OPTIONS', getQueueToken('pending-tasks'), SchedulerElectionService],
        },
      ],
      exports: [QueueService, WorkerService, SchedulerElectionService],
      global: true,
    };
  }

  static forFeature(options: QueueModuleOptions): DynamicModule {
    const { name, role, queueOptions = {} } = options;
    const { pendingQueueName } = queueOptions;

    if (!name) {
      throw new Error('QueueModule.forFeature() requires a "name" property in the options.');
    }
    if (!pendingQueueName) {
      throw new Error('QueueModule.forFeature() requires a "pendingQueueName" in the queueOptions.');
    }

    const providers: Provider[] = [];
    const exportsList: any[] = [];

    const optionsToken = getQueueOptionsToken(name);
    providers.push({ provide: optionsToken, useValue: options });

    const queueServiceToken = getQueueServiceToken(name);
    providers.push({
      provide: queueServiceToken,
      useFactory: (opts: any, queue: any) => new QueueService(opts, queue),
      inject: [optionsToken, getQueueToken(pendingQueueName)],
    });
    exportsList.push(queueServiceToken);

    if (role === 'WORKER' || role === 'BOTH') {
      const workerServiceToken = getWorkerServiceToken(name);
      providers.push({
        provide: workerServiceToken,
        useFactory: (opts: any, electionService: SchedulerElectionService) => new WorkerService(opts, electionService),
        inject: [optionsToken, SchedulerElectionService],
      });
      exportsList.push(workerServiceToken);
    }

    if (role === 'SCHEDULER' || role === 'BOTH') {
      const schedulerProcessorToken = getSchedulerProcessorToken(name);
      providers.push({
        provide: schedulerProcessorToken,
        useFactory: (opts: any, queue: any, electionService: SchedulerElectionService) => new SchedulerProcessor(opts, queue, electionService),
        inject: [optionsToken, getQueueToken(pendingQueueName), SchedulerElectionService],
      });
      // Note: Schedulers are internal and usually not exported.
    }

    return {
      module: QueueModule,
      imports: [BullModule.registerQueue({ name: pendingQueueName })],
      providers,
      exports: exportsList,
    };
  }

  static forFeatureAsync(name: string, options: QueueModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [];
    const exportsList: any[] = [];

    const optionsToken = getQueueOptionsToken(name);
    providers.push({
      provide: optionsToken,
      useFactory: options.useFactory,
      inject: options.inject || [],
    });

    const queueServiceToken = getQueueServiceToken(name);
    providers.push({
      provide: queueServiceToken,
      useFactory: async (opts: QueueModuleOptions, queue: any) => {
        return new QueueService(opts, queue);
      },
      inject: [optionsToken, getQueueToken('pending-tasks')],
    });
    exportsList.push(queueServiceToken);

    // Worker service provider
    const workerServiceToken = getWorkerServiceToken(name);
    providers.push({
      provide: workerServiceToken,
      useFactory: async (opts: QueueModuleOptions, electionService: SchedulerElectionService) => {
        if (opts.role === 'WORKER' || opts.role === 'BOTH') {
          return new WorkerService(opts, electionService);
        }
        return null;
      },
      inject: [optionsToken, SchedulerElectionService],
    });
    exportsList.push(workerServiceToken);

    // Scheduler processor provider
    const schedulerProcessorToken = getSchedulerProcessorToken(name);
    providers.push({
      provide: schedulerProcessorToken,
      useFactory: async (opts: QueueModuleOptions, queue: any, electionService: SchedulerElectionService) => {
        if (opts.role === 'SCHEDULER' || opts.role === 'BOTH') {
          return new SchedulerProcessor(opts, queue, electionService);
        }
        return null;
      },
      inject: [optionsToken, getQueueToken('pending-tasks'), SchedulerElectionService],
    });

    return {
      module: QueueModule,
      imports: [
        ...(options.imports || []),
        BullModule.registerQueue({ name: 'pending-tasks' }),
      ],
      providers,
      exports: exportsList,
    };
  }
}
