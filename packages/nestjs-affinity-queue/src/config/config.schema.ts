import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

/**
 * 队列插件配置验证模式
 */
export class QueueConfigSchema {
  /**
   * Redis 连接 URL
   */
  @IsString()
  @IsOptional()
  redisUrl?: string = 'redis://localhost:6379';

  /**
   * Redis 主机
   */
  @IsString()
  @IsOptional()
  redisHost?: string = 'localhost';

  /**
   * Redis 端口
   */
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(65535)
  redisPort?: number = 6379;

  /**
   * 待调度队列名称
   */
  @IsString()
  @IsOptional()
  pendingQueueName?: string = 'pending-tasks';

  /**
   * Worker 执行队列名称前缀
   */
  @IsString()
  @IsOptional()
  workerQueuePrefix?: string = 'worker-queue';

  /**
   * Worker 状态存储键前缀
   */
  @IsString()
  @IsOptional()
  workerStatePrefix?: string = 'worker-state';

  /**
   * 默认 Worker 最大批次大小
   */
  @IsNumber()
  @IsOptional()
  @Min(1)
  defaultMaxBatchSize?: number = 10;

  /**
   * 调度器轮询间隔（毫秒）
   */
  @IsNumber()
  @IsOptional()
  @Min(100)
  schedulerInterval?: number = 1000;
} 