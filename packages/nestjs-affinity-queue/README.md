# NestJS Affinity Queue

一个基于 BullMQ 的 NestJS 队列模块，支持任务亲和性和分布式调度。

## 功能特性

- 🚀 基于 BullMQ 的高性能队列
- 🎯 任务亲和性支持
- 🔄 分布式调度器选举
- 👥 多工作器支持
- 📊 实时状态监控
- 🔧 灵活的配置选项

## 安装

```bash
npm install nestjs-affinity-queue
```

## 快速开始

### 1. 同步初始化

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    QueueModule.forRoot({
      role: 'BOTH', // SCHEDULER, WORKER, 或 BOTH
      workerOptions: {
        maxBatchSize: 10,
        workerCount: 2,
      },
      redisOptions: {
        host: 'localhost',
        port: 6379,
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
    }),
  ],
})
export class AppModule {}
```

### 2. 异步初始化

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
        role: 'BOTH',
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

### 3. 特性模块使用

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    QueueModule.forFeature({
      name: 'email-queue',
      role: 'WORKER',
      queueOptions: {
        pendingQueueName: 'email-pending',
      },
    }),
  ],
})
export class EmailModule {}
```

### 4. 异步特性模块

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

## 使用服务

### 注入队列服务

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService } from 'nestjs-affinity-queue';
import { Task } from 'nestjs-affinity-queue';

@Injectable()
export class TaskService {
  constructor(private readonly queueService: QueueService) {}

  async addTask(task: Task) {
    return await this.queueService.add(task);
  }

  async getQueueStats() {
    return await this.queueService.getQueueStats();
  }
}
```

### 使用工作器服务

```typescript
import { Injectable } from '@nestjs/common';
import { WorkerService } from 'nestjs-affinity-queue';

@Injectable()
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  async startWorker() {
    await this.workerService.start();
  }

  async stopWorker() {
    await this.workerService.stop();
  }
}
```

## 配置选项

### QueueModuleOptions

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `role` | `'SCHEDULER' \| 'WORKER' \| 'BOTH'` | - | 模块角色 |
| `name` | `string` | - | 队列名称（forFeature 必需） |
| `workerOptions.maxBatchSize` | `number` | `10` | 最大批处理大小 |
| `workerOptions.workerCount` | `number` | `1` | 工作器数量 |
| `redisOptions.host` | `string` | `'localhost'` | Redis 主机 |
| `redisOptions.port` | `number` | `6379` | Redis 端口 |
| `redisOptions.password` | `string` | - | Redis 密码 |
| `redisOptions.db` | `number` | `0` | Redis 数据库 |
| `queueOptions.pendingQueueName` | `string` | `'pending-tasks'` | 待处理队列名称 |
| `queueOptions.workerQueuePrefix` | `string` | `'worker-'` | 工作器队列前缀 |
| `queueOptions.workerStatePrefix` | `string` | `'worker-state-'` | 工作器状态前缀 |
| `queueOptions.schedulerInterval` | `number` | `1000` | 调度器间隔（毫秒） |
| `electionOptions.electionLockTtl` | `number` | `30000` | 选举锁 TTL（毫秒） |
| `electionOptions.heartbeatInterval` | `number` | `5000` | 心跳间隔（毫秒） |
| `electionOptions.heartbeatTimeout` | `number` | `15000` | 心跳超时（毫秒） |

### QueueModuleAsyncOptions

| 属性 | 类型 | 描述 |
|------|------|------|
| `useFactory` | `(...args: any[]) => Promise<QueueModuleOptions> \| QueueModuleOptions` | 工厂函数 |
| `inject` | `any[]` | 依赖注入数组 |
| `imports` | `any[]` | 导入模块数组 |

## 任务接口

```typescript
interface Task {
  id: string;
  type: string;
  data: any;
  affinity?: string;
  priority?: number;
  delay?: number;
  attempts?: number;
}
```

## 许可证

MIT
