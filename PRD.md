## NestJS 可控队列插件：需求规格说明书

- **文档版本**: 1.1
- **更新日期**: 2025 年 6 月 30 日
- **作者**: David & Google Gemini
- **状态**: 定稿

### 1. 引言

#### 1.1 项目目标

本项目旨在创建一个功能强大、可配置的 NestJS 队列插件。该插件通过分离任务调度与执行，实现一个由中央调度节点（Scheduler）和多个工作节点（Worker）组成的分布式任务处理系统。核心目标是实现基于身份标识（`identifyTag`）的“强制亲和性”调度，以满足多租户、有状态或需要顺序处理的业务场景，同时提供机制防止单一身份标识无限占用资源。

#### 1.2 核心概念

- **任务 (Task)**: 系统处理的原子单元，包含任务类型、身份标识和具体数据。
- **调度节点 (Scheduler Node)**: 系统的“大脑”，负责接收所有任务，并根据调度算法将任务分发给工作节点。它不执行具体业务。
- **工作节点 (Worker Node)**: 系统的“执行者”，负责从自己的专属队列中获取并执行任务。
- **身份标识 (identifyTag)**: 任务的分组依据，是实现亲和性调度的关键。例如，企业 ID、用户 ID。
- **待调度队列 (Pending Queue)**: 一个由调度节点管理的中央队列，存放所有已提交但尚未分配的任务。
- **执行队列 (Execution Queue)**: 每个工作节点拥有的私有队列，用于接收调度节点分配来的任务。
- **强制亲和性 (Strict Affinity)**: 一旦一个 `identifyTag` 被某个 Worker 接手处理，在当前批次完成前，所有后续属于该 `identifyTag` 的任务都必须等待该 Worker，不能分配给其他空闲 Worker。

### 2. 系统架构

系统由三个逻辑部分组成，它们通过一个共享的 Redis 实例进行通信和状态同步，完全解耦。

1.  **应用接口层 (`QueueService`)**: 作为插件的统一入口，供 NestJS 应用的其他部分调用，负责将任务提交到待调度队列。
2.  **调度节点 (Scheduler)**:
    - 监听并管理唯一的“待调度队列”。
    - 持续监控所有工作节点的状态。
    - 运行核心的调度算法，将任务从“待调度队列”移动到合适的“执行队列”。
3.  **工作节点 (Workers)**:
    - 每个 Worker 实例监听一个专属的“执行队列”。
    - 当接收到任务后，根据任务类型执行相应的业务逻辑。
    - 执行完成后，负责更新自身状态，并在完成一个批次后解除与 `identifyTag` 的绑定。

**技术栈建议**:

- **消息队列与状态存储**: Redis
- **队列库**: BullMQ (`@nestjs/bullmq`)

### 3. 核心实体定义

#### 3.1 任务对象 (`Task`)

```typescript
interface Task {
  /**
   * 任务类型，用于Worker映射到具体的处理逻辑。
   * e.g., 'generate-invoice', 'send-welcome-email'
   */
  type: string;

  /**
   * 任务的身份标识，调度的核心依据。
   * e.g., 'company-abc', 'user-123'
   */
  identifyTag: string;

  /**
   * 执行任务所需的具体数据。
   */
  payload: any;
}
```

#### 3.2 工作节点状态对象 (`WorkerState`)

该状态对象必须存储在调度节点和工作节点均可访问的共享位置（如 Redis Hash）。

```typescript
interface WorkerState {
  /**
   * Worker 的唯一ID，与进程实例相关。
   */
  workerId: string;

  /**
   * Worker 当前状态。
   * 'idle': 空闲，可以接受任何 identifyTag 的新任务。
   * 'running': 运行中，正在处理一个特定 identifyTag 的任务。
   */
  status: "idle" | "running";

  /**
   * 当前正在处理的 identifyTag。若为空闲状态，则为 null。
   */
  currentIdentifyTag: string | null;

  /**
   * 当前批次已接收/处理的任务数量。
   */
  currentBatchSize: number;
}
```

### 4. 功能需求 (FR)

#### FR1: 任务提交

1.1. 必须提供一个可注入的 NestJS 服务 (例如 `QueueService`) 作为任务提交的唯一入口。
1.2. `QueueService` 必须包含一个公开方法，如 `add(task: Task): Promise<Job>`，用于接收新任务。
1.3. 调用 `add` 方法后，任务应被立即推送到中央的“待调度队列”中。

#### FR2: 工作节点配置

2.1. 每个工作节点必须能够配置一个 `maxBatchSize` (number) 参数。
2.2. `maxBatchSize` 定义了一个工作节点在解除与 `identifyTag` 的绑定关系前，最多可以连续处理的、属于同一个 `identifyTag` 的任务数量。

#### FR3: 工作节点操作

3.1. 每个工作节点实例启动后，仅监听自己的专属“执行队列”。
3.2. 节点必须能根据任务的 `type` 字段，将任务路由到预先注册的处理器 (Handler) 函数。
3.3. 在完成一个批次的处理后，工作节点**必须**自动更新其在共享存储中的状态，以解除与 `identifyTag` 的绑定。此操作的触发条件为： \* 当 `currentBatchSize` 达到 `maxBatchSize` 且批内所有任务处理完毕时。 \* 或，当一个批次开始后，其执行队列变为空时。
3.4. 解除绑定的状态重置操作应为： \* `status` -\> `'idle'` \* `currentIdentifyTag` -\> `null` \* `currentBatchSize` -\> `0`

#### FR4: 调度节点操作

4.1. 调度节点必须持续运行一个调度循环，以处理“待调度队列”中的任务。
4.2. **[防队头阻塞]** 调度循环**不得**仅处理队头任务。它必须有能力遍历（或窥探）队列，以查找任何一个当前可以被调度的任务，避免因队头任务等待而阻塞整个队列。
4.3. **[核心调度算法]** 对于从队列中检视的每一个任务，调度器必须严格遵循以下判断逻辑：

```
1.  **强制亲和性检查 (Strict Affinity Check)**:
    a. 查找是否存在一个 Worker 其 `currentIdentifyTag` 与当前任务的 `task.identifyTag` 相同。
    b. **如果找到**：
        i.  检查该 Worker 的 `currentBatchSize < maxBatchSize`。
        ii. **若条件为真** (批次未满): **分配任务**。将任务从待调度队列移至该 Worker 的执行队列，并更新 Worker 状态 (`currentBatchSize++`)。处理结束。
        iii. **若条件为假** (批次已满): **强制等待**。不分配该任务，并继续在待调度队列中检查下一个任务。**绝不**将此任务分配给其他空闲 Worker。

2.  **空闲节点分配 (Idle Worker Assignment)**:
    a.  仅当**步骤 1**中**未找到**任何处理该 `identifyTag` 的 Worker 时，执行此步。
    b.  查找是否存在任何 Worker 其 `status` 为 `'idle'`。
    c.  **如果找到**：**分配任务**给第一个空闲 Worker。更新其状态为 `status='running'`, `currentIdentifyTag=task.identifyTag`, `currentBatchSize=1`。处理结束。

3.  **保持等待 (Wait)**:
    a.  如果一个任务既不满足**步骤 1** 也不满足**步骤 2**，它将继续保留在待调度队列中，等待下一次调度循环。
```

### 5. 部署与运行环境

#### 5.1 运行模式

本插件设计用于支持在多进程（集群）环境中运行，特别是在使用 PM2 进行进程管理的场景下。系统必须支持将**调度逻辑**和**工作逻辑**分离到不同的进程中。

#### 5.2 进程角色分离

5.2.1. 系统必须提供一种机制来确保在整个集群中，只有一个进程执行调度器（Scheduler）的职责。
5.2.2. 推荐使用环境变量（例如 `APP_ROLE`）进行角色区分。当 `APP_ROLE` 为 `SCHEDULER` 时，进程加载调度器模块；当为 `WORKER` 时，加载工作节点模块。
5.2.3. 系统应与 PM2 的 `ecosystem.config.js` 文件良好集成，允许用户显式地配置一个单实例的调度器进程和多个实例的工作节点集群。 \* **示例 `ecosystem.config.js`**:
`javascript module.exports = { apps: [ { name: 'app-scheduler', script: 'dist/main.js', instances: 1, exec_mode: 'fork', env: { NODE_ENV: 'production', APP_ROLE: 'SCHEDULER' }, }, { name: 'app-workers', script: 'dist/main.js', instances: -1, // 使用所有可用核心 exec_mode: 'cluster', env: { NODE_ENV: 'production', APP_ROLE: 'WORKER' }, }, ], }; `

#### 5.3 跨进程通信

5.3.1. 所有跨进程的任务分发和状态同步必须通过共享的 Redis 服务进行，插件不应依赖任何特定于主机的 IPC 机制。
5.3.2. 工作节点应能通过环境变量（如 PM2 的 `NODE_APP_INSTANCE`）识别自身在集群中的唯一编号，并据此监听其专属的执行队列（例如 `worker-queue-${process.env.NODE_APP_INSTANCE}`）。

### 6. 非功能性需求 (NFR)

- **可扩展性**: 架构应支持水平扩展，即通过增加 Worker 节点实例来提高系统的整体任务处理能力。
- **容错性**: 任务和状态应持久化（例如在 Redis 中），确保在节点（调度器或 Worker）重启后，系统可以从中断处恢复，任务不会丢失。
- **可配置性**: Redis 连接信息、队列名称、默认的 `maxBatchSize` 等关键参数应通过标准的 NestJS 配置 (`ConfigModule`) 进行管理。
- **可观测性**: 应提供日志记录关键事件（如任务添加、调度、执行、完成、失败）。推荐集成如 `bull-board` 之类的工具，以提供一个可视化管理界面。

### 7. 范围外及未来规划 (Out of Scope / Future Considerations)

- **V1.0 范围外**:
  - 高级公平性调度算法（如加权轮询、优先级队列）。
  - 任务的动态优先级调整。
  - 任务的取消、暂停与恢复 API。
  - 基于队列负载的 Worker 节点自动伸缩。
- **未来可能**:
  - 将上述范围外功能作为 V2.0 的目标。
  - 为调度器实现基于分布式锁（如 Redlock）的高可用方案，以在调度器进程失败时自动进行故障转移。

### 8. 初步项目结构

```
nestjs-affinity-queue/
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions: 自动化测试、Lint、构建
├── .gitignore
├── .prettierrc                # Prettier 代码格式化配置
├── LICENSE                    # 开源许可证 (例如 AGPL)
├── package.json               # 根 package.json，用于管理整个 monorepo
├── pnpm-workspace.yaml        # 或 lerna.json / package.json 中的 "workspaces"
├── README.md                  # ❗ 项目总览、徽章、安装和快速上手指南
├── tsconfig.base.json         # 基础的 TypeScript 配置，供各子项目继承
└─── packages/
     │
     ├── nestjs-affinity-queue/  # ⬅️ 这是要发布到 NPM 的核心插件包
     │   ├── src/
     │   │   ├── common/         # 通用 DTOs, Interfaces, Enums, Decorators
     │   │   │   ├── dtos/
     │   │   │   │   └── task.dto.ts
     │   │   │   └── interfaces/
     │   │   │       ├── task.interface.ts
     │   │   │       └── worker-state.interface.ts
     │   │   │
     │   │   ├── config/         # 插件配置相关
     │   │   │   ├── config.schema.ts
     │   │   │   └── config.ts
     │   │   │
     │   │   ├── scheduler/      # 调度器模块
     │   │   │   ├── scheduler.module.ts
     │   │   │   └── scheduler.processor.ts
     │   │   │
     │   │   ├── worker/         # 工作节点模块 (仅包含逻辑，由示例应用加载)
     │   │   │   ├── worker.module.ts
     │   │   │   └── worker.processor.ts
     │   │   │
     │   │   ├── queue.module.ts # ⬅️ 插件的核心入口模块
     │   │   ├── queue.service.ts  # 暴露给用户的、用于添加任务的服务
     │   │   └── index.ts        # 整个包的出口文件，导出公共 API
     │   │
     │   ├── README.md           # 详细的 API 文档和用法说明
     │   ├── package.json        # 核心插件的 package.json (定义名称, 版本, peerDependencies等)
     │   └── tsconfig.json       # 核心插件的 TypeScript 配置
     │
     └── example/                # ➡️ 完整的 NestJS 示例应用，用于演示和测试
         ├── src/
         │   ├── app.controller.ts # 示例 Controller，调用 QueueService 添加任务
         │   ├── app.module.ts     # 示例应用的根模块，在这里导入和配置你的插件
         │   ├── app.service.ts
         │   └── main.ts
         │
         ├── .env.example          # 环境变量示例文件 (如 REDIS_URL)
         ├── ecosystem.config.js   # ⬅️ PM2 配置文件，演示调度器和Worker集群分离
         ├── package.json          # 示例应用的 package.json
         └── tsconfig.json         # 示例应用的 TypeScript 配置
```
