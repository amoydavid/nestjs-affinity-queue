# 分布式调度器选举机制

## 概述

本插件实现了分布式调度器选举机制，确保在多个节点以 `BOTH` 模式运行时，只有一个节点会真正成为调度器，其他节点仅作为工作节点运行。这支持跨节点和跨服务器的任务分配。

## 工作原理

### 1. 选举机制

- **分布式锁**：使用 Redis 的 `SET` 命令的 `NX` 和 `EX` 选项实现分布式锁
- **心跳机制**：领导者定期发送心跳，非领导者监控领导者状态
- **自动故障转移**：当领导者失效时，其他节点自动接管

### 2. 节点角色

- **领导者（Leader）**：负责任务调度和分配
- **跟随者（Follower）**：仅作为工作节点处理任务
- **动态切换**：节点可以在领导者和跟随者之间动态切换

### 3. Worker 注册

- 所有 Worker 节点都会注册到选举服务
- 定期发送心跳保持活跃状态
- 过期 Worker 会被自动清理

## 配置选项

### 选举配置

```typescript
electionOptions: {
  // 选举锁的过期时间（毫秒）
  electionLockTtl: 30000,
  // 心跳间隔（毫秒）
  heartbeatInterval: 10000,
  // 心跳超时时间（毫秒）
  heartbeatTimeout: 60000,
}
```

### 环境变量

```bash
# 选举配置
ELECTION_LOCK_TTL=30000
HEARTBEAT_INTERVAL=10000
HEARTBEAT_TIMEOUT=60000
```

## 使用方式

### 1. 基本配置

```typescript
import { QueueModule } from 'nestjs-affinity-queue';

@Module({
  imports: [
    QueueModule.forRoot({
      role: 'BOTH', // 所有节点都是 BOTH 模式
      electionOptions: {
        electionLockTtl: 30000,
        heartbeatInterval: 10000,
        heartbeatTimeout: 60000,
      },
    }),
  ],
})
export class AppModule {}
```

### 2. PM2 配置

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

### 3. 启动命令

```bash
# 启动选举模式
pm2 start ecosystem-election.config.js

# 查看状态
pm2 list
pm2 logs

# 检查选举状态
redis-cli get scheduler:election:lock
redis-cli get scheduler:leader:info
redis-cli hgetall scheduler:worker:registry
```

## 监控和调试

### 1. 日志信息

- **选举成功**：`节点 {nodeId} 成为调度器领导者`
- **选举失败**：`当前节点不是调度器领导者，仅作为 Worker 运行`
- **心跳超时**：`领导者 {nodeId} 心跳超时，尝试接管`
- **Worker 注册**：`Worker {workerId} 已注册`

### 2. Redis 键

- `scheduler:election:lock`：选举锁
- `scheduler:leader:info`：领导者信息
- `scheduler:worker:registry`：Worker 注册表

### 3. 状态检查

```bash
# 检查当前领导者
redis-cli get scheduler:leader:info | jq

# 检查注册的 Worker
redis-cli hgetall scheduler:worker:registry

# 检查选举锁
redis-cli get scheduler:election:lock
```

## 故障处理

### 1. 领导者失效

- 自动检测心跳超时
- 删除过期的选举锁
- 其他节点尝试成为新领导者
- 恢复孤儿任务

### 2. 网络分区

- 使用 Redis 作为中心化的协调服务
- 心跳机制检测节点状态
- 自动清理过期注册

### 3. 重启恢复

- 启动时自动参与选举
- 恢复之前的 Worker 注册
- 清理过期的状态信息

## 性能考虑

### 1. 选举开销

- 心跳间隔：10秒（可配置）
- 锁过期时间：30秒（可配置）
- 超时检测：60秒（可配置）

### 2. 网络开销

- 心跳消息：每10秒一次
- 状态同步：按需更新
- Redis 连接：复用现有连接

### 3. 扩展性

- 支持任意数量的节点
- 自动负载均衡
- 跨服务器部署

## 最佳实践

### 1. 配置建议

```typescript
// 生产环境推荐配置
electionOptions: {
  electionLockTtl: 30000,    // 30秒
  heartbeatInterval: 10000,  // 10秒
  heartbeatTimeout: 60000,   // 60秒
}
```

### 2. 监控建议

- 监控领导者状态变化
- 监控 Worker 注册数量
- 监控心跳延迟
- 设置告警机制

### 3. 部署建议

- 使用 PM2 集群模式
- 配置合适的实例数量
- 监控系统资源使用
- 定期检查日志

## 示例

完整的示例代码请参考 `packages/example/` 目录：

- `ecosystem-election.config.js`：PM2 配置
- `test-election.sh`：测试脚本
- `src/app.module.ts`：应用配置 