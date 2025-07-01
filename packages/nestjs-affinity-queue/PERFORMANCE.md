# 性能优化指南

## Redis KEYS 命令优化

### 问题描述

在生产环境中，使用 `Redis.keys` 命令会导致严重的性能问题：

1. **阻塞服务器**：`KEYS` 命令会遍历整个数据库，在数据量大时会阻塞 Redis 服务器
2. **影响其他操作**：阻塞期间，其他 Redis 操作会被延迟
3. **不可预测的响应时间**：响应时间与数据库大小成正比

### 解决方案

使用 `SCAN` 命令替代 `KEYS` 命令：

#### 优势

1. **非阻塞**：`SCAN` 命令是增量式的，不会阻塞服务器
2. **可控制**：可以设置每次扫描的数量，控制资源消耗
3. **可中断**：支持游标机制，可以分批次处理
4. **生产友好**：适合在生产环境中使用

#### 实现方式

```typescript
/**
 * 使用 SCAN 命令安全地获取匹配模式的键
 */
static async scanKeys(redis: Redis, pattern: string, count: number = 100): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  
  return keys;
}
```

### 使用场景

#### 1. 恢复孤儿任务

```typescript
// 获取所有 Worker 队列
const workerQueuePattern = `${this.config.workerQueuePrefix}-*`;
const queueKeys = await RedisUtils.scanKeys(this.redis, workerQueuePattern);
```

#### 2. 清理过期状态

```typescript
// 获取所有 Worker 状态
const pattern = `${this.config.workerStatePrefix}:*`;
const keys = await RedisUtils.scanKeys(this.redis, pattern);
```

#### 3. 获取 Worker 状态

```typescript
// 获取所有活跃的 Worker 状态
const workerStates = await this.getAllWorkerStates();
```

### 性能对比

| 方法 | 数据量 | 响应时间 | 服务器影响 |
|------|--------|----------|------------|
| `KEYS` | 1K 键 | ~1ms | 轻微 |
| `KEYS` | 10K 键 | ~10ms | 中等 |
| `KEYS` | 100K 键 | ~100ms | 严重 |
| `KEYS` | 1M 键 | ~1s | 阻塞 |
| `SCAN` | 任意 | ~1-5ms | 无影响 |

### 配置建议

#### 扫描批次大小

```typescript
// 小数据量（< 10K 键）
const keys = await RedisUtils.scanKeys(redis, pattern, 50);

// 中等数据量（10K - 100K 键）
const keys = await RedisUtils.scanKeys(redis, pattern, 100);

// 大数据量（> 100K 键）
const keys = await RedisUtils.scanKeys(redis, pattern, 200);
```

#### 扫描间隔

```typescript
// 避免频繁扫描
const SCAN_INTERVAL = 5000; // 5秒

setInterval(async () => {
  await this.cleanupExpiredWorkerStates();
}, SCAN_INTERVAL);
```

### 监控指标

#### 1. 扫描性能

```typescript
const startTime = Date.now();
const keys = await RedisUtils.scanKeys(redis, pattern);
const duration = Date.now() - startTime;

if (duration > 100) {
  this.logger.warn(`SCAN 操作耗时较长: ${duration}ms`);
}
```

#### 2. 内存使用

```typescript
// 监控扫描过程中的内存使用
const memoryBefore = process.memoryUsage().heapUsed;
const keys = await RedisUtils.scanKeys(redis, pattern);
const memoryAfter = process.memoryUsage().heapUsed;
const memoryIncrease = memoryAfter - memoryBefore;

if (memoryIncrease > 10 * 1024 * 1024) { // 10MB
  this.logger.warn(`SCAN 操作内存使用较高: ${memoryIncrease / 1024 / 1024}MB`);
}
```

### 最佳实践

#### 1. 避免在生产高峰期扫描

```typescript
// 在低峰期执行清理操作
const currentHour = new Date().getHours();
if (currentHour >= 2 && currentHour <= 6) {
  await this.cleanupExpiredWorkerStates();
}
```

#### 2. 使用适当的模式匹配

```typescript
// 好的模式：具体且有限
const pattern = 'worker-state:worker-*';

// 避免的模式：过于宽泛
const pattern = '*';
```

#### 3. 实现超时机制

```typescript
async scanKeysWithTimeout(redis: Redis, pattern: string, timeout: number = 5000): Promise<string[]> {
  return Promise.race([
    RedisUtils.scanKeys(redis, pattern),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('SCAN timeout')), timeout)
    )
  ]);
}
```

#### 4. 错误处理和重试

```typescript
async scanKeysWithRetry(redis: Redis, pattern: string, maxRetries: number = 3): Promise<string[]> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await RedisUtils.scanKeys(redis, pattern);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### 工具类使用

```typescript
import { RedisUtils } from 'nestjs-affinity-queue';

// 扫描键
const keys = await RedisUtils.scanKeys(redis, 'pattern:*');

// 扫描哈希字段
const fields = await RedisUtils.scanHashFields(redis, 'hash-key', 'field:*');

// 扫描集合成员
const members = await RedisUtils.scanSetMembers(redis, 'set-key', 'member:*');
```

### 总结

通过使用 `SCAN` 命令替代 `KEYS` 命令，我们实现了：

1. **性能提升**：避免了 Redis 服务器阻塞
2. **可扩展性**：支持大规模数据环境
3. **稳定性**：提高了系统的稳定性
4. **生产就绪**：适合在生产环境中使用

这个优化确保了系统在高负载和大数据量环境下的稳定运行。 