# NestJS Affinity Queue 示例应用

这是一个完整的 NestJS 应用示例，演示如何使用 `nestjs-affinity-queue` 插件实现基于身份标识的强制亲和性任务调度。

## 🎯 功能特性

- **强制亲和性调度**：相同 `identifyTag` 的任务必须由同一 Worker 处理
- **防队头阻塞**：调度器能够处理队列中的任意任务，避免阻塞
- **批次控制**：防止单一身份标识垄断资源
- **分布式架构**：调度器与 Worker 分离，支持水平扩展
- **多任务类型**：支持邮件发送、发票生成、数据处理等多种任务类型

## 🏗️ 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   应用接口层     │    │    调度器       │    │    Worker节点   │
│  (QueueService) │───▶│  (Scheduler)    │───▶│   (Worker)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Redis 存储    │
                    │  (队列+状态)    │
                    └─────────────────┘
```

## 📦 安装和运行

### 前置要求

- Node.js 18+
- Redis 服务器
- pnpm (推荐) 或 npm

### 1. 安装依赖

```bash
# 在项目根目录
pnpm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```bash
# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # 可选
REDIS_DB=0  # 可选，默认为 0

# 应用配置
APP_ROLE=BOTH          # SCHEDULER | WORKER | BOTH
MAX_BATCH_SIZE=5       # Worker 最大批次大小
PORT=3000              # 应用端口

# 其他队列配置（可选）
PENDING_QUEUE_NAME=pending-tasks
WORKER_QUEUE_PREFIX=worker-queue
WORKER_STATE_PREFIX=worker-state
DEFAULT_MAX_BATCH_SIZE=10
SCHEDULER_INTERVAL=1000
```

### 3. 启动 Redis

```bash
# 使用 Docker
docker run -d -p 6379:6379 redis:alpine

# 或使用本地 Redis
redis-server
```

### 4. 启动应用

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run start

# 构建后运行
npm run build
npm run start:prod
```

## 🚀 使用指南

### API 端点

#### 1. 健康检查
```bash
GET http://localhost:3000/
# 返回: "NestJS Affinity Queue 示例应用运行中！"
```

#### 2. 添加单个任务
```bash
POST http://localhost:3000/tasks
Content-Type: application/json

{
  "type": "send-email",
  "identifyTag": "company-123",
  "payload": {
    "to": "user@example.com",
    "subject": "测试邮件"
  }
}
```

#### 3. 批量添加任务
```bash
POST http://localhost:3000/tasks/batch?count=10&companies=3
# 添加 10 个任务，分配到 3 个不同的公司
```

#### 4. 查看队列状态
```bash
GET http://localhost:3000/queue/stats
# 返回: {"waiting":0,"active":0,"completed":0,"failed":0}
```

### 支持的任务类型

#### 1. 邮件发送 (send-email)
```json
{
  "type": "send-email",
  "identifyTag": "company-123",
  "payload": {
    "to": "user@example.com",
    "subject": "邮件主题",
    "content": "邮件内容"
  }
}
```

#### 2. 发票生成 (generate-invoice)
```json
{
  "type": "generate-invoice",
  "identifyTag": "company-123",
  "payload": {
    "amount": 1000,
    "description": "服务费用",
    "customerId": "CUST-001"
  }
}
```

#### 3. 数据处理 (process-data)
```json
{
  "type": "process-data",
  "identifyTag": "company-123",
  "payload": {
    "recordCount": 100,
    "operation": "数据分析",
    "dataSource": "database"
  }
}
```

## 🧪 测试用例

### 测试脚本

运行测试脚本：

```bash
# 运行所有测试
./test-suite.sh

# 或单独运行特定测试
./test-affinity.sh      # 亲和性测试
./test-batch.sh         # 批量任务测试
./test-parallel.sh      # 并行处理测试
```

### 测试场景

#### 1. 亲和性调度测试
```bash
# 测试相同 identifyTag 的任务被同一 Worker 处理
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send-email",
    "identifyTag": "company-affinity-test",
    "payload": {"to": "user1@test.com", "subject": "测试1"}
  }'

# 连续添加相同 identifyTag 的任务
for i in {2..5}; do
  curl -X POST http://localhost:3000/tasks \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"send-email\",
      \"identifyTag\": \"company-affinity-test\",
      \"payload\": {\"to\": \"user$i@test.com\", \"subject\": \"测试$i\"}
    }"
done
```

#### 2. 并行处理测试
```bash
# 添加不同 identifyTag 的任务，应该并行处理
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "generate-invoice",
    "identifyTag": "company-parallel-1",
    "payload": {"amount": 1000, "description": "服务1"}
  }'

curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "process-data",
    "identifyTag": "company-parallel-2",
    "payload": {"recordCount": 50, "operation": "分析1"}
  }'
```

#### 3. 批次控制测试
```bash
# 添加超过 maxBatchSize 的任务
for i in {1..10}; do
  curl -X POST http://localhost:3000/tasks \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"send-email\",
      \"identifyTag\": \"company-batch-test\",
      \"payload\": {\"to\": \"user$i@test.com\", \"subject\": \"批次测试$i\"}
    }"
done
```

## 🔧 配置选项

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `APP_ROLE` | `BOTH` | 应用角色：SCHEDULER/WORKER/BOTH |
| `MAX_BATCH_SIZE` | `5` | Worker 最大批次大小 |
| `REDIS_HOST` | `localhost` | Redis 主机地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | `null` | Redis 密码 |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `PORT` | `3000` | 应用端口 |
| `PENDING_QUEUE_NAME` | `pending-tasks` | 待处理队列名称 |
| `WORKER_QUEUE_PREFIX` | `worker-queue` | Worker 队列前缀 |
| `WORKER_STATE_PREFIX` | `worker-state` | Worker 状态前缀 |
| `DEFAULT_MAX_BATCH_SIZE` | `10` | 默认最大批次大小 |
| `SCHEDULER_INTERVAL` | `1000` | 调度器间隔时间 |

### 角色说明

- **SCHEDULER**: 仅运行调度器，负责任务分配
- **WORKER**: 仅运行 Worker，负责任务执行
- **BOTH**: 同时运行调度器和 Worker（示例应用默认）

## 📊 监控和调试

### 查看日志

应用启动时会显示详细的日志信息：

```
🚀 应用启动，角色: BOTH
[SchedulerProcessor] 调度器已启动
[DynamicWorkerProcessor] Worker worker-0-1234567890 已启动
[TaskHandlerService] 所有任务处理器已注册
```

### Redis 状态检查

```bash
# 查看待处理任务
redis-cli llen "bull:pending-tasks:wait"

# 查看 Worker 状态
redis-cli keys "*worker*state*"

# 查看特定 Worker 状态
redis-cli hgetall "worker-state:worker-0-1234567890"
```

### 队列状态监控

```bash
# 实时监控队列状态
watch -n 2 'curl -s http://localhost:3000/queue/stats'
```

## 🚨 故障排除

### 常见问题

1. **任务不处理**
   - 检查 Redis 连接
   - 清理残留的 Worker 状态：`redis-cli keys "*worker*state*" | xargs redis-cli del`

2. **Worker 不启动**
   - 检查 `APP_ROLE` 配置
   - 确认 Redis 服务运行正常

3. **调度器不分配任务**
   - 检查 Worker 状态是否正确
   - 查看调度器日志

### 清理状态

```bash
# 清理所有队列数据
redis-cli flushall

# 清理特定队列
redis-cli del "bull:pending-tasks:wait"
redis-cli del "bull:pending-tasks:active"
redis-cli del "bull:pending-tasks:completed"
```

## 📚 相关文档

- [nestjs-affinity-queue 插件文档](../nestjs-affinity-queue/README.md)
- [PRD 需求规格说明书](../../PRD.md)
- [项目架构说明](../../README.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## �� 许可证

MIT License 