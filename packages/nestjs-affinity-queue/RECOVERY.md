# 系统重启任务恢复机制

## 问题描述

在分布式系统中，当 Worker 进程重启时，由于 `workerId` 会重新生成（包含时间戳），之前分配给特定 Worker 的任务就会"丢失"。这些任务仍然存在于旧的 Worker 队列中，但新的 Worker 实例无法访问这些队列，导致任务无法被处理。

## 解决方案

### 1. 稳定的 Worker ID 生成

**问题**：原来的 Worker ID 生成策略使用时间戳，每次重启都会生成不同的 ID。

```typescript
// 原来的实现
const workerId = `worker-${i}-${Date.now()}`;
```

**解决方案**：使用更稳定的 ID 生成策略，基于主机名和进程 ID。

```typescript
// 新的实现
private generateStableWorkerId(index: number): string {
  const processId = process.pid;
  const hostname = require('os').hostname().replace(/[^a-zA-Z0-9]/g, '');
  return `worker-${hostname}-${processId}-${index}`;
}
```

**优势**：
- 同一进程重启时，Worker ID 保持一致
- 不同主机和进程的 Worker ID 不会冲突
- 便于调试和监控

### 2. 孤儿任务恢复机制

**实现位置**：`SchedulerProcessor.onModuleInit()`

**工作流程**：

1. **启动时检查**：调度器启动时自动检查所有 Worker 队列
2. **发现孤儿任务**：查找等待中和活跃的任务
3. **优先级排序**：活跃任务优先，然后按创建时间排序
4. **重新入队**：将任务重新添加到调度队列头部（高优先级）
5. **清理旧队列**：从原 Worker 队列中移除任务

**核心代码**：

```typescript
private async recoverOrphanedTasks(): Promise<void> {
  // 获取所有 Worker 队列
  const workerQueuePattern = `${this.config.workerQueuePrefix}-*`;
  const queueKeys = await this.scanKeys(workerQueuePattern);
  
  for (const queueKey of queueKeys) {
    const queueName = queueKey.replace('bull:', '');
    await this.recoverTasksFromQueue(queueName);
  }
}

/**
 * 使用 SCAN 命令安全地获取匹配模式的键
 */
private async scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  
  do {
    const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  
  return keys;
}
```

### 3. Worker 状态清理

**实现位置**：`WorkerService.onModuleInit()` 和 `WorkerManager`

**功能**：
- 清理不再活跃的 Worker 状态记录
- 避免状态数据累积
- 确保状态与实际 Worker 实例一致

## 使用方式

### 自动恢复

系统会在以下情况下自动执行恢复：

1. **调度器启动时**：自动检查并恢复孤儿任务
2. **Worker 启动时**：自动清理过期状态

### 手动触发

如果需要手动触发恢复，可以调用相应的方法：

```typescript
// 在调度器中手动触发恢复
await schedulerProcessor.recoverOrphanedTasks();

// 在 Worker 服务中手动清理状态
await workerService.cleanupExpiredWorkerStates();
```

## 测试验证

使用提供的测试脚本验证恢复机制：

```bash
# 运行恢复测试
./test-recovery.sh
```

**测试步骤**：
1. 启动系统并添加任务
2. 模拟系统重启（停止所有进程）
3. 重新启动系统
4. 验证任务是否被正确恢复和重新分配

**预期结果**：
- 调度器启动时显示恢复日志
- 任务被重新分配到调度队列
- Worker 状态被正确清理和重建

## 配置选项

可以通过环境变量配置恢复行为：

```bash
# Worker 队列前缀
WORKER_QUEUE_PREFIX=my-app-worker-queue

# Worker 状态前缀
WORKER_STATE_PREFIX=my-app-worker-state

# 调度器检查间隔
SCHEDULER_INTERVAL=1000
```

## 监控和日志

系统会输出详细的恢复日志：

```
[INFO] 开始检查孤儿任务...
[INFO] 发现队列 worker-queue-worker-hostname-12345-0 中有 2 个未完成任务
[INFO] 已恢复任务 123 (company-abc) 从队列 worker-queue-worker-hostname-12345-0
[INFO] 成功恢复 2 个孤儿任务到调度队列
[INFO] 开始清理过期的 Worker 状态...
[INFO] 成功清理了 1 个过期的 Worker 状态
```

## 注意事项

1. **性能考虑**：恢复过程只在启动时执行，不会影响正常运行时的性能
2. **数据一致性**：恢复的任务会保持原有的优先级和顺序
3. **错误处理**：如果恢复过程中出现错误，系统会记录日志但不会中断启动流程
4. **并发安全**：恢复机制使用 Redis 事务确保数据一致性

## 最佳实践

1. **定期监控**：关注恢复日志，了解系统重启频率
2. **合理配置**：根据业务需求调整 Worker 数量和批次大小
3. **测试验证**：在生产环境部署前，充分测试恢复机制
4. **备份策略**：定期备份 Redis 数据，确保数据安全 