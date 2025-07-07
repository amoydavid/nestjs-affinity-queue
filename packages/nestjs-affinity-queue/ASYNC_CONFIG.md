# 异步配置指南

本文档介绍如何使用 `QueueModule` 的异步配置方法 `forRootAsync` 和 `forFeatureAsync`。

## 概述

异步配置方法允许您：
- 从数据库、远程配置服务等异步获取配置
- 在模块初始化时动态计算配置选项
- 使用依赖注入来获取配置值

## forRootAsync 方法

### 基本用法

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule.forRoot(),
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
  ],
})
export class AppModule {}
```

### 从远程服务获取配置

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // 从远程配置服务获取 Redis 配置
        const redisConfig = await fetchRedisConfig();
        
        return {
          role: 'BOTH',
          workerOptions: {
            maxBatchSize: 10,
            workerCount: 2,
          },
          redisOptions: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db,
          },
          queueOptions: {
            pendingQueueName: 'pending-tasks',
            workerQueuePrefix: 'worker-',
            schedulerInterval: 1000,
          },
          electionOptions: {
            electionLockTtl: 30000,
            heartbeatInterval: 5000,
            heartbeatTimeout: 15000,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}

async function fetchRedisConfig() {
  // 实现从远程服务获取配置的逻辑
  const response = await fetch('https://config-service.example.com/redis');
  return response.json();
}
```

### 使用多个依赖

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule, DatabaseService } from './database';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    QueueModule.forRootAsync({
      imports: [ConfigModule, DatabaseModule],
      useFactory: async (
        configService: ConfigService,
        databaseService: DatabaseService,
      ) => {
        // 从数据库获取配置
        const queueConfig = await databaseService.getQueueConfiguration();
        
        return {
          role: queueConfig.role || configService.get('APP_ROLE', 'BOTH'),
          workerOptions: {
            maxBatchSize: queueConfig.maxBatchSize || configService.get('QUEUE_MAX_BATCH_SIZE', 10),
            workerCount: queueConfig.workerCount || configService.get('QUEUE_WORKER_COUNT', 2),
          },
          redisOptions: {
            host: queueConfig.redisHost || configService.get('REDIS_HOST', 'localhost'),
            port: queueConfig.redisPort || configService.get('REDIS_PORT', 6379),
            password: queueConfig.redisPassword || configService.get('REDIS_PASSWORD'),
            db: queueConfig.redisDb || configService.get('REDIS_DB', 0),
          },
          queueOptions: {
            pendingQueueName: queueConfig.pendingQueueName || configService.get('QUEUE_PENDING_NAME', 'pending-tasks'),
            workerQueuePrefix: queueConfig.workerQueuePrefix || configService.get('QUEUE_WORKER_PREFIX', 'worker-'),
            schedulerInterval: queueConfig.schedulerInterval || configService.get('QUEUE_SCHEDULER_INTERVAL', 1000),
          },
          electionOptions: {
            electionLockTtl: queueConfig.electionLockTtl || configService.get('ELECTION_LOCK_TTL', 30000),
            heartbeatInterval: queueConfig.heartbeatInterval || configService.get('ELECTION_HEARTBEAT_INTERVAL', 5000),
            heartbeatTimeout: queueConfig.heartbeatTimeout || configService.get('ELECTION_HEARTBEAT_TIMEOUT', 15000),
          },
        };
      },
      inject: [ConfigService, DatabaseService],
    }),
  ],
})
export class AppModule {}
```

## forFeatureAsync 方法

### 基本用法

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule,
    QueueModule.forFeatureAsync('email-queue', {
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        name: 'email-queue',
        role: 'WORKER',
        queueOptions: {
          pendingQueueName: configService.get('EMAIL_QUEUE_NAME', 'email-pending'),
        },
        workerOptions: {
          maxBatchSize: configService.get('EMAIL_BATCH_SIZE', 5),
          workerCount: configService.get('EMAIL_WORKER_COUNT', 1),
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class EmailModule {}
```

### 从远程服务获取特定队列配置

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule,
    QueueModule.forFeatureAsync('notification-queue', {
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // 从远程服务获取特定队列的配置
        const queueConfig = await fetchQueueConfig('notification-queue');
        
        return {
          name: 'notification-queue',
          role: 'WORKER',
          queueOptions: {
            pendingQueueName: queueConfig.queueName,
          },
          workerOptions: {
            maxBatchSize: queueConfig.batchSize,
            workerCount: queueConfig.workerCount,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class NotificationModule {}

async function fetchQueueConfig(queueName: string) {
  const response = await fetch(`https://config-service.example.com/queues/${queueName}`);
  return response.json();
}
```

## 配置选项

### QueueModuleAsyncOptions

| 属性 | 类型 | 描述 |
|------|------|------|
| `useFactory` | `(...args: any[]) => Promise<QueueModuleOptions> \| QueueModuleOptions` | 工厂函数，返回配置对象 |
| `inject` | `any[]` | 依赖注入数组，对应 useFactory 的参数 |
| `imports` | `any[]` | 需要导入的模块数组 |

### 注意事项

1. **异步工厂函数**: `useFactory` 可以是同步或异步函数
2. **依赖注入**: `inject` 数组中的顺序必须与 `useFactory` 函数的参数顺序一致
3. **模块导入**: 如果工厂函数依赖其他模块的服务，需要在 `imports` 数组中声明
4. **错误处理**: 工厂函数中的错误会导致模块初始化失败
5. **配置验证**: 建议在工厂函数中添加配置验证逻辑

## 最佳实践

1. **配置验证**: 在工厂函数中验证配置的完整性和有效性
2. **错误处理**: 添加适当的错误处理和日志记录
3. **缓存配置**: 对于远程配置，考虑添加缓存机制
4. **类型安全**: 使用 TypeScript 类型来确保配置的正确性
5. **环境隔离**: 为不同环境（开发、测试、生产）使用不同的配置源

## 示例：完整的异步配置

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        try {
          // 从多个源获取配置
          const [redisConfig, queueConfig] = await Promise.all([
            fetchRedisConfig(),
            fetchQueueConfig(),
          ]);

          // 验证配置
          validateConfiguration(redisConfig, queueConfig);

          return {
            role: configService.get('APP_ROLE', 'BOTH') as 'SCHEDULER' | 'WORKER' | 'BOTH',
            workerOptions: {
              maxBatchSize: queueConfig.maxBatchSize || configService.get('QUEUE_MAX_BATCH_SIZE', 10),
              workerCount: queueConfig.workerCount || configService.get('QUEUE_WORKER_COUNT', 2),
            },
            redisOptions: {
              host: redisConfig.host || configService.get('REDIS_HOST', 'localhost'),
              port: redisConfig.port || configService.get('REDIS_PORT', 6379),
              password: redisConfig.password || configService.get('REDIS_PASSWORD'),
              db: redisConfig.db || configService.get('REDIS_DB', 0),
            },
            queueOptions: {
              pendingQueueName: queueConfig.pendingQueueName || configService.get('QUEUE_PENDING_NAME', 'pending-tasks'),
              workerQueuePrefix: queueConfig.workerQueuePrefix || configService.get('QUEUE_WORKER_PREFIX', 'worker-'),
              schedulerInterval: queueConfig.schedulerInterval || configService.get('QUEUE_SCHEDULER_INTERVAL', 1000),
            },
            electionOptions: {
              electionLockTtl: queueConfig.electionLockTtl || configService.get('ELECTION_LOCK_TTL', 30000),
              heartbeatInterval: queueConfig.heartbeatInterval || configService.get('ELECTION_HEARTBEAT_INTERVAL', 5000),
              heartbeatTimeout: queueConfig.heartbeatTimeout || configService.get('ELECTION_HEARTBEAT_TIMEOUT', 15000),
            },
          };
        } catch (error) {
          console.error('Failed to load queue configuration:', error);
          throw new Error('Queue configuration failed to load');
        }
      },
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}

async function fetchRedisConfig() {
  // 实现从远程服务获取 Redis 配置
}

async function fetchQueueConfig() {
  // 实现从远程服务获取队列配置
}

function validateConfiguration(redisConfig: any, queueConfig: any) {
  // 实现配置验证逻辑
}