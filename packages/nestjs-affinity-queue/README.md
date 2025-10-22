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
- 🎚️ identifyTag 并发数控制 (NEW!)

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
        concurrency: 2, // 新增：每个 Worker 的并发度（每个实例内的并行度）
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
          concurrency: configService.get('QUEUE_WORKER_CONCURRENCY', 2),
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
        concurrency: 2,
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
          concurrency: configService.get('EMAIL_WORKER_CONCURRENCY', 2),
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
| `workerOptions.concurrency` | `number` | `1` | 单个 Worker 并发度（每实例内并行度） |
| `redisOptions.host` | `string` | `'localhost'` | Redis 主机 |
| `redisOptions.port` | `number` | `6379` | Redis 端口 |
| `redisOptions.password` | `string` | - | Redis 密码 |
| `redisOptions.db` | `number` | `0` | Redis 数据库 |
| `queueOptions.pendingQueueName` | `string` | `'pending-tasks'` | 待处理队列名称 |
| `queueOptions.workerQueuePrefix` | `string` | `'worker-'` | 工作器队列前缀 |
| `queueOptions.workerStatePrefix` | `string` | `'worker-state-'` | 工作器状态前缀 |
| `queueOptions.schedulerInterval` | `number` | `1000` | 调度器间隔（毫秒） |
| `queueOptions.identifyTagConcurrency` | `number \| Record<string, number>` | `1` | identifyTag 并发数控制 |
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

## identifyTag 并发数控制

`identifyTag` 并发数控制功能允许您为每个 `identifyTag` 设置最大并发 worker 数量，从而实现更精细的任务调度控制。

### 功能特性

- **默认并发数**: 每个 `identifyTag` 默认最多只能有 1 个 worker 同时运行
- **灵活配置**: 支持全局配置、特定标签配置，以及混合配置
- **实时监控**: 在 Worker 状态表格中显示每个 `identifyTag` 的并发情况
- **智能调度**: 当达到并发限制时，任务会等待现有 worker 完成或有新的 worker 可用

### 配置方式

#### 1. 全局数字配置

```typescript
QueueModule.forRoot({
  queueOptions: {
    identifyTagConcurrency: 2, // 所有 identifyTag 最多 2 个 worker
  }
})
```

#### 2. 特定标签配置

```typescript
QueueModule.forRoot({
  queueOptions: {
    identifyTagConcurrency: {
      'high-priority': 3,    // high-priority 最多 3 个 worker
      'batch-process': 2,    // batch-process 最多 2 个 worker
      'single-task': 1,      // single-task 最多 1 个 worker
    }
  }
})
```

#### 3. 混合配置（推荐）

```typescript
QueueModule.forRoot({
  queueOptions: {
    identifyTagConcurrency: {
      default: 1,            // 默认并发数
      'high-priority': 3,    // 特定标签的并发数
      'batch-process': 2,
      'real-time': 5,
    }
  }
})
```

### 工作原理

#### 调度逻辑

1. **并发检查**: 调度器首先检查当前 `identifyTag` 的运行中 worker 数量
2. **限制判断**: 如果已达到最大并发数，尝试复用现有 worker（如果未达到批次限制）
3. **新 Worker 分配**: 如果未达到并发限制，分配新的空闲 worker
4. **等待机制**: 如果无法分配，任务将等待直到有 worker 可用

#### 优先级规则

1. **亲和性优先**: 优先使用已处理相同 `identifyTag` 的 worker
2. **批次限制**: 在 `maxBatchSize` 限制内复用 worker
3. **并发限制**: 确保不超过 `identifyTag` 的最大并发数
4. **空闲分配**: 在限制内分配空闲 worker

### 监控和日志

#### Worker 状态表格

```
┌──────────────────────┬────────┬─────────────────┬───────────┬─────────┬───────────┐
│ Worker ID            │ Status │ Current Tag     │ Batch Cnt │ Job ID  │ Queue Len │
├──────────────────────┼────────┼─────────────────┼───────────┼─────────┼───────────┤
│ node-hostname-123... │ 🟢 RUN │ high-priority   │ 2         │ 1234    │ 3         │
│ node-hostname-456... │ 🟢 RUN │ high-priority   │ 1         │ 1235    │ 2         │
│ node-hostname-789... │ 🟢 RUN │ batch-process   │ 1         │ 1236    │ 1         │
│ node-hostname-012... │ ⚪ IDLE │ -               │ 0         │ -       │ 0         │
└──────────────────────┴────────┴─────────────────┴───────────┴─────────┴───────────┘
```

#### 统计信息

```
📈 统计: 运行中=3, 空闲=1, 总批次计数=4, 实时队列总长=6, 标签分布=[high-priority:3(2/3), batch-process:1(1/2)]
💡 说明: 标签分布格式=tag:批次数(运行中worker数/最大并发数)
```

#### 调试日志

```
[DEBUG] identifyTag high-priority 当前运行中的 worker 数量: 2/3
[DEBUG] Worker node-hostname-123 assigned task high-priority, batch size increased from 1 to: 2
[DEBUG] Task single-task is waiting due to concurrency limit (1/1)
```

### 使用示例

#### 基本使用

```typescript
// 配置
QueueModule.forRoot({
  queueOptions: {
    identifyTagConcurrency: {
      default: 1,
      'email-sending': 3,
      'file-processing': 2,
    }
  }
})

// 添加任务
await queueService.add({
  type: 'email',
  identifyTag: 'email-sending',  // 最多 3 个 worker
  data: { recipient: 'user@example.com' }
});

await queueService.add({
  type: 'process',
  identifyTag: 'file-processing',  // 最多 2 个 worker
  data: { filePath: '/path/to/file' }
});
```

#### 环境变量配置

```bash
# 在应用启动时通过环境变量配置
export IDENTIFY_TAG_CONCURRENCY='{"default":1,"high-priority":3,"batch-process":2}'
```

```typescript
QueueModule.forRoot({
  queueOptions: {
    identifyTagConcurrency: process.env.IDENTIFY_TAG_CONCURRENCY 
      ? JSON.parse(process.env.IDENTIFY_TAG_CONCURRENCY)
      : { default: 1 }
  }
})
```

### 最佳实践

#### 1. 合理设置并发数

```typescript
// 根据任务特性设置并发数
{
  default: 1,                    // 默认保守设置
  'cpu-intensive': 1,            // CPU 密集型任务，避免竞争
  'io-bound': 5,                 // I/O 密集型任务，可以更高并发
  'network-request': 3,          // 网络请求，中等并发
  'database-operation': 2,       // 数据库操作，避免连接池耗尽
}
```

#### 2. 监控和调优

- 定期检查 Worker 状态表格
- 观察任务等待时间
- 根据系统负载调整并发数
- 使用不同的 `identifyTag` 隔离不同类型的任务

#### 3. 错误处理

```typescript
// 为不同类型的任务设置不同的重试策略
await queueService.add({
  type: 'critical-task',
  identifyTag: 'critical-operations',  // 低并发，高可靠性
  data: { /* ... */ }
});
```

### 注意事项

1. **内存使用**: 更高的并发数会增加内存使用
2. **资源竞争**: 注意避免资源竞争（数据库连接、文件锁等）
3. **系统负载**: 根据系统性能合理设置并发数
4. **任务设计**: 确保任务是无状态的，可以并行执行

### 迁移指南

#### 从旧版本升级

如果您之前没有配置 `identifyTagConcurrency`，默认行为保持不变（每个 `identifyTag` 最多 1 个 worker）。

要启用新功能，只需在配置中添加：

```typescript
QueueModule.forRoot({
  queueOptions: {
    // 其他配置...
    identifyTagConcurrency: {
      default: 1,  // 保持原有行为
      // 为需要更高并发的标签增加配置
      'high-throughput': 5,
    }
  }
})
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

## PM2 集群部署示例

在 PM2 集群下，推荐采用“单 Leader（调度器），多 Worker”的模式：仅 leader 节点执行调度，但所有实例都运行 Worker 进行消费。保持 `role: 'BOTH'` 即可，调度器会通过选举自动只在一个实例上运行。

### 单应用多实例（BOTH，推荐入门）

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'affinity-app',
      script: 'dist/main.js',
      instances: 4,            // PM2 cluster 模式 4 实例
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'BOTH',      // 调度器+Worker；仅 leader 会启用调度
        QUEUE_WORKER_COUNT: 1, // 每实例内 Worker 数
        QUEUE_WORKER_CONCURRENCY: 2 // 每个 Worker 并发
      }
    }
  ]
}
```

要点：
- 所有实例都会启动 Worker；只有 1 个实例当选 leader 启动调度器。
- 通过 `QUEUE_WORKER_COUNT` 与 `QUEUE_WORKER_CONCURRENCY` 叠加可提升单实例吞吐。

### 进阶：调度/工作器分离（更强可控性）

```javascript
// ecosystem.split.config.js
module.exports = {
  apps: [
    // Scheduler 单例
    {
      name: 'affinity-scheduler',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'SCHEDULER'
      }
    },
    // Worker 组，可水平扩展
    {
      name: 'affinity-worker',
      script: 'dist/main.js',
      instances: 4,           // 或者 'max'
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'WORKER',
        QUEUE_WORKER_COUNT: 1,
        QUEUE_WORKER_CONCURRENCY: 2
      }
    }
  ]
}
```

要点：
- Scheduler 与 Worker 解耦，伸缩更可控。
- 若你仅需要 1 个调度器，保持 `instances: 1` 即可，无需依赖选举。

无论采用哪种方式，请确保所有实例连接到同一 Redis，并且 `pendingQueueName` 等队列配置保持一致。任务亲和与 `identifyTagConcurrency` 将自动在多实例间生效。 

## 许可证

MIT
