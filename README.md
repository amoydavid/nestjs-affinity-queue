# NestJS Affinity Queue 工作空间

这是一个功能强大的 NestJS 队列插件工作空间，支持基于身份标识的强制亲和性调度。

## 项目结构

```
nestjs-affinity-queue/
├── packages/
│   ├── nestjs-affinity-queue/    # 📦 核心插件包
│   └── example/                  # 🚀 示例应用
├── README.md                     # 📖 项目说明
├── package.json                  # 📋 根配置
├── pnpm-workspace.yaml          # 🔧 工作空间配置
└── tsconfig.base.json           # ⚙️ TypeScript 基础配置
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建插件

```bash
pnpm build:plugin
```

### 3. 启动示例应用

```bash
# 开发模式
pnpm dev:example

# 或者构建并启动
pnpm build
cd packages/example
pnpm start:prod
```

### 4. 启动 Redis（必需）

```bash
# 使用 Docker
docker run -d -p 6379:6379 redis:7-alpine

# 或者本地安装的 Redis
redis-server
```

## 使用示例

### 基本任务提交

```bash
# 添加单个任务
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send-email",
    "identifyTag": "company-123",
    "payload": {
      "to": "user@example.com",
      "subject": "欢迎邮件"
    }
  }'

# 批量添加测试任务
curl -X POST "http://localhost:3000/tasks/batch?count=20&companies=3"

# 查看队列状态
curl http://localhost:3000/queue/stats
```

## PM2 集群部署

这个插件特别设计用于 PM2 集群环境，支持调度器和 Worker 的完全分离：

```bash
# 构建应用
pnpm build

# 使用 PM2 启动集群
cd packages/example
pm2 start ecosystem.config.js
```

这将启动：
- 1 个调度器进程（单例）
- N 个 Worker 进程（使用所有可用CPU核心）

## 核心特性

### 🎯 强制亲和性调度

- 基于 `identifyTag` 的任务分组
- 确保相同 `identifyTag` 的任务按顺序处理
- 防止并发冲突和状态不一致

### 🔄 分布式架构

- 调度器与工作节点完全分离
- 支持水平扩展
- Redis 作为通信中介

### 📊 批次控制

- 可配置的批次大小限制
- 防止单一标识垄断资源
- 自动状态重置和负载均衡

## 开发

### 工作空间命令

```bash
# 安装所有依赖
pnpm install

# 构建所有包
pnpm build

# 格式化代码
pnpm format

# 运行测试
pnpm test

# 清理构建产物
pnpm clean
```

### 本地开发

```bash
# 启动示例应用（开发模式）
pnpm dev:example

# 监听插件构建
pnpm --filter nestjs-affinity-queue build:watch
```

## 文档

- [插件 API 文档](./packages/nestjs-affinity-queue/README.md)
- [示例应用说明](./packages/example/README.md)
- [需求规格说明](./PRD.md)

## 许可证

MIT - 详见 [LICENSE](./LICENSE) 文件 