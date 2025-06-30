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
        maxBatchSize: 10,
        workerCount: 1,
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
  constructor(private readonly queueService: QueueService) {}

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
import { Injectable, OnModuleInit } from '@nestjs/common';
import { WorkerService } from 'nestjs-affinity-queue';

@Injectable()
export class TaskHandlerService implements OnModuleInit {
  constructor(private readonly workerService: WorkerService) {}

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

### 环境变量

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
```

## 许可证

AGPL-3.0
