# NestJS Affinity Queue

一个功能强大的 NestJS 队列插件，支持基于身份标识的强制亲和性调度。

## 特性

- 🎯 **强制亲和性调度**: 基于 `identifyTag` 的任务分组处理
- 🔄 **分布式架构**: 调度器与工作节点分离
- 📊 **批次控制**: 可配置的批次大小限制
- 🚀 **高性能**: 基于 Redis 和 BullMQ
- 🛡️ **类型安全**: 完整的 TypeScript 支持
- 🔧 **高度可配置**: 灵活的配置选项
- 🏭 **动态 Worker 管理**: 支持多 Worker 实例和动态处理器注册
- 🏢 **多实例隔离**: 支持自定义队列前缀，同一 Redis 中运行多个独立队列实例
- 🔄 **系统重启恢复**: 自动恢复系统重启后的孤儿任务
- 🧹 **状态清理**: 自动清理过期的 Worker 状态
- ⚡ **性能优化**: 使用 Redis SCAN 命令避免阻塞
- 👑 **分布式选举**: 支持多节点自动选举调度器领导者
- 🔄 **自动故障转移**: 领导者失效时自动切换
- 🌐 **跨节点部署**: 支持跨服务器和跨实例的任务分配

## 安装

```bash
npm install nestjs-affinity-queue
# 或
pnpm add nestjs-affinity-queue
```

## 基本用法

### 1. 导入模块

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    QueueModule.forRoot({
      role: 'BOTH', // 'SCHEDULER' | 'WORKER' | 'BOTH'
      workerOptions: {
        maxBatchSize: 10, // 单批次最大任务数
        workerCount: 1, // worker数量
      },
      redisOptions: {
        host: 'localhost',
        port: 6379,
        password: 'your-password', // 可选
        db: 0, // 可选
      },
      queueOptions: {
        // 自定义队列前缀，支持多实例隔离
        pendingQueueName: 'my-app-pending-tasks',
        workerQueuePrefix: 'my-app-worker-queue',
        workerStatePrefix: 'my-app-worker-state',
        schedulerInterval: 1000, // 毫秒
      },
      electionOptions: {
        // 选举配置（可选）
        electionLockTtl: 30000,    // 选举锁过期时间（毫秒）
        heartbeatInterval: 10000,  // 心跳间隔（毫秒）
        heartbeatTimeout: 60000,   // 心跳超时时间（毫秒）
      },
    }),
    // 多队列配置演示
    QueueModule.forFeature({
      name: 'high-priority',
      role: 'BOTH', // 'SCHEDULER' | 'WORKER' | 'BOTH'
      workerOptions: {
        maxBatchSize: 10, // 单批次最大任务数
        workerCount: 1, // worker数量
      },
      redisOptions: {
        host: 'localhost',
        port: 6379,
        password: 'your-password', // 可选
        db: 0, // 可选
      },
      queueOptions: {
        // 自定义队列前缀，支持多实例隔离
        pendingQueueName: 'high-app-pending-tasks',
        workerQueuePrefix: 'high-app-worker-queue',
        workerStatePrefix: 'high-app-worker-state',
        schedulerInterval: 1000, // 毫秒
      },
      electionOptions: {
        // 选举配置（可选）
        electionLockTtl: 30000,    // 选举锁过期时间（毫秒）
        heartbeatInterval: 10000,  // 心跳间隔（毫秒）
        heartbeatTimeout: 60000,   // 心跳超时时间（毫秒）
      },
    }),
  ],
})
export class AppModule {}
```

### 2. 添加任务

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService, Task } from 'nestjs-affinity-queue';

@Injectable()
export class TaskService {
  constructor(
    private readonly queueService: QueueService,

    // 注入特定队列
    @Inject(getQueueServiceToken('high-priority')) 
    private readonly highPriorityQueueService: QueueService,
  ) {}

  async addTask() {
    const task: Task = {
      type: 'send-email',
      identifyTag: 'company-123',
      payload: {
        to: 'user@example.com',
        subject: '欢迎邮件',
      },
    };

    return await this.queueService.add(task);
  }
}
```

### 3. 注册任务处理器

```typescript
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { WorkerService, getWorkerServiceToken } from 'nestjs-affinity-queue';

@Injectable()
export class TaskHandlerService implements OnModuleInit {
  constructor(
    private readonly workerService: WorkerService,
    @Optional()
    @Inject(getWorkerServiceToken('high-priority')) 
    private readonly highPriorityWorkerService: WorkerService,
    ) {}

  async onModuleInit() {
    this.registerHandlers();
  }

  private registerHandlers() {
    // 注册邮件发送处理器
    this.workerService.registerHandler('send-email', this.handleSendEmail.bind(this));
    
    // 注册发票生成处理器
    this.workerService.registerHandler('generate-invoice', this.handleGenerateInvoice.bind(this));
    
    // 注册数据处理处理器
    this.workerService.registerHandler('process-data', this.handleProcessData.bind(this));

    //对highPriorityWorkerService注册处理器
  }

  private async handleSendEmail(payload: any) {
    console.log('发送邮件:', payload);
    // 处理邮件发送逻辑
    return { status: 'sent', messageId: `MSG-${Date.now()}` };
  }

  private async handleGenerateInvoice(payload: any) {
    console.log('生成发票:', payload);
    // 处理发票生成逻辑
    return { status: 'generated', invoiceId: `INV-${Date.now()}` };
  }

  private async handleProcessData(payload: any) {
    console.log('处理数据:', payload);
    // 处理数据逻辑
    return { status: 'completed', processId: `PROC-${Date.now()}` };
  }
}
```

## 配置

### 推荐配置方式（通过参数传入）

```typescript
QueueModule.forRoot({
  role: 'BOTH',
  workerOptions: {
    maxBatchSize: 10,
    workerCount: 1,
  },
  redisOptions: {
    host: 'localhost',
    port: 6379,
    password: 'your-password', // 可选
    db: 0, // 可选
  },
  queueOptions: {
    // 自定义队列前缀，支持多实例隔离
    pendingQueueName: 'my-app-pending-tasks',
    workerQueuePrefix: 'my-app-worker-queue', 
    workerStatePrefix: 'my-app-worker-state',
    schedulerInterval: 1000, // 毫秒
  },
})
```

### 环境变量配置（可选）

```bash
# Redis 配置
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# 队列配置
PENDING_QUEUE_NAME=pending-tasks
WORKER_QUEUE_PREFIX=worker-queue
WORKER_STATE_PREFIX=worker-state

# Worker 配置
MAX_BATCH_SIZE=10
WORKER_COUNT=1

# 调度器配置
SCHEDULER_INTERVAL=1000

# 应用角色
APP_ROLE=BOTH  # SCHEDULER | WORKER | BOTH

# 选举配置（可选）
ELECTION_LOCK_TTL=30000
HEARTBEAT_INTERVAL=10000
HEARTBEAT_TIMEOUT=60000
```

### PM2 集群部署

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'app-scheduler',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { 
        NODE_ENV: 'production',
        APP_ROLE: 'SCHEDULER' 
      },
    },
    {
      name: 'app-workers',
      script: 'dist/main.js',
      instances: -1, // 使用所有核心
      exec_mode: 'cluster',
      env: { 
        NODE_ENV: 'production',
        APP_ROLE: 'WORKER' 
      },
    },
  ],
};
```

### 多实例隔离示例

如果你有多个应用实例需要在同一个 Redis 中运行，可以通过自定义队列前缀来隔离：

```typescript
// 应用 A
QueueModule.forRoot({
  role: 'BOTH',
  queueOptions: {
    pendingQueueName: 'app-a-pending-tasks',
    workerQueuePrefix: 'app-a-worker-queue',
    workerStatePrefix: 'app-a-worker-state',
  },
})

// 应用 B  
QueueModule.forRoot({
  role: 'BOTH',
  queueOptions: {
    pendingQueueName: 'app-b-pending-tasks',
    workerQueuePrefix: 'app-b-worker-queue',
    workerStatePrefix: 'app-b-worker-state',
  },
})
```

## 核心概念

### 强制亲和性

一旦某个 `identifyTag` 被分配给特定的 Worker，该 Worker 将继续处理所有相同 `identifyTag` 的任务，直到：

1. 达到最大批次大小 (`maxBatchSize`)
2. 队列为空

### 任务对象

```typescript
interface Task {
  type: string;        // 任务类型
  identifyTag: string; // 身份标识
  payload: any;        // 任务数据
}
```

### Worker 状态

```typescript
interface WorkerState {
  workerId: string;
  status: 'idle' | 'running';
  currentIdentifyTag: string | null;
  currentBatchSize: number;
}
```

## API 文档

### QueueService

- `add(task: Task): Promise<Job>` - 添加任务到队列
- `getQueueStats(): Promise<any>` - 获取队列统计信息

### WorkerService

- `registerHandler(type: string, handler: Function)` - 注册任务处理器
- `start()` - 启动 Worker 服务
- `stop()` - 停止 Worker 服务

### 配置接口

```typescript
interface QueueModuleOptions {
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
    electionLockTtl?: number;    // 选举锁过期时间（毫秒）
    heartbeatInterval?: number;  // 心跳间隔（毫秒）
    heartbeatTimeout?: number;   // 心跳超时时间（毫秒）
  };
}
```

## 使用示例

### 完整的应用示例

```typescript
// app.module.ts
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
    }),
    QueueModule.forRoot({
      role: (process.env.APP_ROLE as 'SCHEDULER' | 'WORKER' | 'BOTH') || 'BOTH',
      workerOptions: {
        maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '5', 10),
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, TaskHandlerService],
})
export class AppModule {}

// app.controller.ts
import { Controller, Post, Body, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Task } from 'nestjs-affinity-queue';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('tasks')
  async addTask(@Body() task: Task) {
    return await this.appService.addTask(task);
  }

  @Get('queue/stats')
  async getQueueStats() {
    return await this.appService.getQueueStats();
  }
}

// app.service.ts
import { Injectable } from '@nestjs/common';
import { QueueService, Task } from 'nestjs-affinity-queue';

@Injectable()
export class AppService {
  constructor(private readonly queueService: QueueService) {}

  async addTask(task: Task) {
    const job = await this.queueService.add(task);
    return {
      message: '任务已添加到队列',
      jobId: job.id,
      task,
    };
  }

  async getQueueStats() {
    return await this.queueService.getQueueStats();
  }
}
```

## 分布式选举功能

### 概述

当所有节点都以 `BOTH` 模式运行时，系统会自动选举出一个节点作为调度器领导者，其他节点仅作为工作节点运行。这支持跨节点和跨服务器的任务分配。

### 选举机制

- **分布式锁**：使用 Redis 实现分布式锁确保只有一个领导者
- **心跳机制**：领导者定期发送心跳，非领导者监控领导者状态
- **自动故障转移**：当领导者失效时，其他节点自动接管

### 使用方式

```javascript
// ecosystem-election.config.js
module.exports = {
  apps: [
    {
      name: 'affinity-queue-election',
      script: 'dist/main.js',
      instances: -1, // 使用所有可用核心
      exec_mode: 'cluster',
      env: {
        APP_ROLE: 'BOTH', // 所有实例都是 BOTH 模式
        ELECTION_LOCK_TTL: '30000',
        HEARTBEAT_INTERVAL: '10000',
        HEARTBEAT_TIMEOUT: '60000',
      },
    },
  ],
};
```

### 监控选举状态

```bash
# 检查当前领导者
redis-cli get scheduler:leader:info | jq

# 检查注册的 Worker
redis-cli hgetall scheduler:worker:registry

# 检查选举锁
redis-cli get scheduler:election:lock
```

详细说明请参考 [ELECTION.md](./ELECTION.md)。

## 系统重启恢复

系统支持自动恢复系统重启后的孤儿任务。当 Worker 进程重启时，调度器会自动检查并恢复未完成的任务。

### 恢复机制

1. **启动时检查**: 调度器启动时自动检查所有 Worker 队列
2. **任务恢复**: 将未完成的任务重新添加到调度队列头部
3. **状态清理**: 自动清理过期的 Worker 状态记录

### 测试恢复机制

```bash
# 运行恢复测试
./test-recovery.sh
```

详细说明请参考 [RECOVERY.md](./RECOVERY.md)

## 性能优化

系统使用 Redis SCAN 命令替代 KEYS 命令，避免在生产环境中阻塞 Redis 服务器。

### 主要优化

1. **非阻塞操作**: 使用 SCAN 命令进行增量扫描
2. **可控制资源**: 支持设置扫描批次大小
3. **生产友好**: 适合大规模数据环境

详细说明请参考 [PERFORMANCE.md](./PERFORMANCE.md)

## 测试

项目包含完整的测试脚本：

```bash
# 亲和性调度测试
./test-affinity.sh

# 并行处理测试
./test-parallel.sh

# 完整功能测试
./test-suite.sh

# Worker 日志测试
./test-simple-worker.sh

# 系统重启恢复测试
./test-recovery.sh
```

## 许可证

MIT
