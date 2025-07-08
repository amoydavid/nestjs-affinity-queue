# NestJS Affinity Queue

一个基于 BullMQ 的 NestJS 队列模块，支持任务亲和性和分布式调度。

## 功能特性

- 🚀 基于 BullMQ 的高性能队列
- 🎯 任务亲和性支持
- 🔄 分布式调度器选举
- 👥 多工作器支持
- 📊 实时状态监控
- 🔧 灵活的配置选项
- 🎛️ 多队列支持 (NEW!)

## 安装

```bash
npm install nestjs-affinity-queue
```

## 快速开始

### 1. 全局队列配置 (forRoot)

#### 同步配置

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

#### 异步配置

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

### 2. 特性队列配置 (forFeature)

#### 同步特性配置

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    // 注册一个名为 'email-queue' 的特性队列
    QueueModule.forFeature({
      name: 'email-queue',
      role: 'WORKER',
      workerOptions: {
        maxBatchSize: 5,
        workerCount: 1,
      },
      queueOptions: {
        pendingQueueName: 'email-pending-tasks',
        workerQueuePrefix: 'email-worker-',
        workerStatePrefix: 'email-worker-state-',
        schedulerInterval: 2000,
      },
      electionOptions: {
        electionLockTtl: 60000,
        heartbeatInterval: 10000,
        heartbeatTimeout: 30000,
      },
    }),
  ],
})
export class EmailModule {}
```

#### 异步特性配置

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
        workerOptions: {
          maxBatchSize: configService.get('EMAIL_BATCH_SIZE', 5),
          workerCount: configService.get('EMAIL_WORKER_COUNT', 1),
        },
        queueOptions: {
          pendingQueueName: configService.get('EMAIL_QUEUE_NAME', 'email-pending-tasks'),
          workerQueuePrefix: configService.get('EMAIL_WORKER_PREFIX', 'email-worker-'),
          workerStatePrefix: configService.get('EMAIL_WORKER_STATE_PREFIX', 'email-worker-state-'),
          schedulerInterval: configService.get('EMAIL_SCHEDULER_INTERVAL', 2000),
        },
        electionOptions: {
          electionLockTtl: configService.get('EMAIL_ELECTION_LOCK_TTL', 60000),
          heartbeatInterval: configService.get('EMAIL_HEARTBEAT_INTERVAL', 10000),
          heartbeatTimeout: configService.get('EMAIL_HEARTBEAT_TIMEOUT', 30000),
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class EmailModule {}
```

## 多队列使用示例

### 同时使用多个队列

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    // 全局默认队列
    QueueModule.forRoot({
      role: 'BOTH',
      workerOptions: { maxBatchSize: 10 },
      queueOptions: { pendingQueueName: 'default-pending' },
    }),
    
    // 邮件队列
    QueueModule.forFeature({
      name: 'email-queue',
      role: 'BOTH',
      workerOptions: { maxBatchSize: 5 },
      queueOptions: {
        pendingQueueName: 'email-pending',
        workerQueuePrefix: 'email-worker-',
        workerStatePrefix: 'email-state-',
      },
    }),
    
    // 文件处理队列
    QueueModule.forFeature({
      name: 'file-queue',
      role: 'WORKER',
      workerOptions: { maxBatchSize: 3 },
      queueOptions: {
        pendingQueueName: 'file-pending',
        workerQueuePrefix: 'file-worker-',
        workerStatePrefix: 'file-state-',
      },
    }),
  ],
})
export class AppModule {}
```

### 注入和使用特定队列服务

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { QueueService, QueueModule } from 'nestjs-affinity-queue';

@Injectable()
export class TaskService {
  constructor(
    // 注入默认队列服务
    private readonly defaultQueueService: QueueService,
    
    // 注入指定名称的队列服务
    @Inject(QueueModule.getQueueService('email-queue'))
    private readonly emailQueueService: QueueService,
    
    @Inject(QueueModule.getQueueService('file-queue'))
    private readonly fileQueueService: QueueService,
  ) {}

  async addDefaultTask(task: any) {
    return await this.defaultQueueService.add(task);
  }

  async addEmailTask(task: any) {
    return await this.emailQueueService.add(task);
  }

  async addFileTask(task: any) {
    return await this.fileQueueService.add(task);
  }

  async getEmailQueueStats() {
    return await this.emailQueueService.getQueueStats();
  }
}
```

### 注入工作器服务

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { WorkerService, QueueModule } from 'nestjs-affinity-queue';

@Injectable()
export class WorkerController {
  constructor(
    // 注入默认工作器服务
    private readonly defaultWorkerService: WorkerService,
    
    // 注入指定名称的工作器服务
    @Inject(QueueModule.getWorkerService('email-queue'))
    private readonly emailWorkerService: WorkerService,
  ) {}

  async registerEmailHandlers() {
    this.emailWorkerService.registerHandler('send-email', async (payload) => {
      console.log('Sending email:', payload);
      // 邮件发送逻辑
      return { success: true };
    });

    this.emailWorkerService.registerHandler('send-newsletter', async (payload) => {
      console.log('Sending newsletter:', payload);
      // 邮件群发逻辑
      return { success: true };
    });
  }
}
```

## 配置选项

### QueueModuleOptions (forRoot)

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `role` | `'SCHEDULER' \| 'WORKER' \| 'BOTH'` | - | 模块角色 |
| `name` | `string` | `'default'` | 队列名称 |
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

### QueueModuleFeatureOptions (forFeature)

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `name` | `string` | - | **必需** 队列名称 |
| `role` | `'SCHEDULER' \| 'WORKER' \| 'BOTH'` | - | **必需** 模块角色 |
| `queueOptions.pendingQueueName` | `string` | - | **必需** 待处理队列名称 |
| 其他选项 | - | - | 与 QueueModuleOptions 相同 |

### 异步配置选项

| 属性 | 类型 | 描述 |
|------|------|------|
| `useFactory` | `(...args: any[]) => Promise<Options> \| Options` | 工厂函数 |
| `inject` | `any[]` | 依赖注入数组 |
| `imports` | `any[]` | 导入模块数组 |

## 任务接口

```typescript
interface Task {
  type: string;           // 任务类型
  identifyTag: string;    // 身份标识（亲和性标识）
  payload: any;           // 任务数据
}
```

## 静态方法

### 获取服务注入令牌

```typescript
// 获取队列服务注入令牌
QueueModule.getQueueService('queue-name')

// 获取工作器服务注入令牌  
QueueModule.getWorkerService('queue-name')

// 获取调度器处理器注入令牌
QueueModule.getSchedulerProcessor('queue-name')
```

## 最佳实践

### 1. 队列命名约定

```typescript
// 推荐使用有意义的队列名称
QueueModule.forFeature({
  name: 'user-notifications',  // 清晰描述队列用途
  queueOptions: {
    pendingQueueName: 'user-notifications-pending',
    workerQueuePrefix: 'user-notifications-worker-',
    workerStatePrefix: 'user-notifications-state-',
  },
});
```

### 2. 角色分离

```typescript
// 生产环境建议分离调度器和工作器
const role = process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH';

QueueModule.forRoot({
  role,
  // 其他配置...
});
```

### 3. 环境配置

```typescript
// .env 文件
REDIS_HOST=localhost
REDIS_PORT=6379
EMAIL_QUEUE_MAX_BATCH=5
FILE_QUEUE_MAX_BATCH=3
APP_ROLE=BOTH
```

## 许可证

MIT
