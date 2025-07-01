import { registerAs } from '@nestjs/config';

/**
 * 队列配置接口
 */
export interface QueueConfig {
  redisUrl: string;
  redisHost: string;
  redisPort: number;
  pendingQueueName: string;
  workerQueuePrefix: string;
  workerStatePrefix: string;
  defaultMaxBatchSize: number;
  schedulerInterval: number;
}

/**
 * 队列配置工厂函数
 */
export const queueConfig = registerAs('queue', (): QueueConfig => {
  // 获取模块级别的队列选项（如果存在）
  const moduleQueueOptions = (global as any).__QUEUE_MODULE_OPTIONS__ || {};
  
  return {
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    pendingQueueName: moduleQueueOptions.pendingQueueName || process.env.PENDING_QUEUE_NAME || 'pending-tasks',
    workerQueuePrefix: moduleQueueOptions.workerQueuePrefix || process.env.WORKER_QUEUE_PREFIX || 'worker-queue',
    workerStatePrefix: moduleQueueOptions.workerStatePrefix || process.env.WORKER_STATE_PREFIX || 'worker-state',
    defaultMaxBatchSize: parseInt(process.env.DEFAULT_MAX_BATCH_SIZE || '10', 10),
    schedulerInterval: moduleQueueOptions.schedulerInterval || parseInt(process.env.SCHEDULER_INTERVAL || '1000', 10),
  };
}); 