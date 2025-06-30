import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { queueConfig } from '../config/config';

@Injectable()
@Processor('worker-queue-0')
export class WorkerProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(WorkerProcessor.name);
  private redis: Redis;
  private workerId: string;
  private maxBatchSize: number;
  private taskHandlers: Map<string, (payload: any) => Promise<any>> = new Map();

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    super();
    this.workerId = this.generateWorkerId();
    this.maxBatchSize = this.config.defaultMaxBatchSize;
  }

  async onModuleInit() {
    // 初始化 Redis 连接
    this.redis = new Redis(this.config.redisUrl);
    
    // 初始化 Worker 状态
    await this.initializeWorkerState();
    
    this.logger.log(`Worker ${this.workerId} 已启动，监听队列: ${this.config.workerQueuePrefix}-${this.workerId}`);
    this.logger.log(`Worker 配置: maxBatchSize=${this.maxBatchSize}, redisUrl=${this.config.redisUrl}`);
  }

  /**
   * 生成唯一的 Worker ID
   */
  private generateWorkerId(): string {
    const instanceId = process.env.NODE_APP_INSTANCE || '0';
    const timestamp = Date.now();
    return `worker-${instanceId}-${timestamp}`;
  }

  /**
   * 初始化 Worker 状态
   */
  private async initializeWorkerState(): Promise<void> {
    const state: WorkerState = {
      workerId: this.workerId,
      status: 'idle',
      currentIdentifyTag: null,
      currentBatchSize: 0,
    };

    await this.updateWorkerState(state);
    this.logger.log(`Worker ${this.workerId} 状态已初始化: ${JSON.stringify(state)}`);
  }

  /**
   * 处理任务
   */
  async process(job: Job): Promise<any> {
    const task = job.data as Task;
    this.logger.log(`Worker ${this.workerId} 开始处理任务: ${JSON.stringify(task)}`);

    try {
      // 查找任务处理器
      const handler = this.taskHandlers.get(task.type);
      
      if (!handler) {
        this.logger.error(`未找到任务类型 '${task.type}' 的处理器，可用处理器: ${Array.from(this.taskHandlers.keys()).join(', ')}`);
        throw new Error(`未找到任务类型 '${task.type}' 的处理器`);
      }

      this.logger.log(`Worker ${this.workerId} 找到处理器，开始执行任务: ${task.type}`);

      // 执行任务
      const result = await handler(task.payload);
      
      this.logger.log(`Worker ${this.workerId} 完成任务 ${task.type}: ${task.identifyTag}, 结果: ${JSON.stringify(result)}`);
      
      return result;
    } catch (error) {
      this.logger.error(`Worker ${this.workerId} 处理任务失败:`, error);
      throw error;
    }
  }

  /**
   * 注册任务处理器
   * @param taskType 任务类型
   * @param handler 处理器函数
   */
  registerHandler(taskType: string, handler: (payload: any) => Promise<any>): void {
    this.taskHandlers.set(taskType, handler);
    this.logger.log(`已注册任务处理器: ${taskType}`);
    this.logger.log(`当前已注册的处理器: ${Array.from(this.taskHandlers.keys()).join(', ')}`);
  }

  /**
   * 任务完成后的处理
   */
  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    const task = job.data as Task;
    this.logger.log(`Worker ${this.workerId} 任务完成事件触发: ${job.id}, 任务类型: ${task.type}`);
    
    // 获取当前状态
    const currentState = await this.getWorkerState();
    
    if (currentState) {
      this.logger.log(`Worker ${this.workerId} 当前状态: ${JSON.stringify(currentState)}`);
      
      // 检查是否应该重置状态
      const shouldReset = await this.shouldResetWorkerState(currentState);
      
      if (shouldReset) {
        await this.resetWorkerState();
        this.logger.log(`Worker ${this.workerId} 完成批次，状态已重置`);
      } else {
        this.logger.log(`Worker ${this.workerId} 批次未完成，保持当前状态`);
      }
    } else {
      this.logger.warn(`Worker ${this.workerId} 无法获取当前状态`);
    }
  }

  /**
   * 任务失败后的处理
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    this.logger.error(`Worker ${this.workerId} 任务失败 ${job.id}:`, error);
    
    // 任务失败也可能需要重置状态
    const currentState = await this.getWorkerState();
    if (currentState) {
      const shouldReset = await this.shouldResetWorkerState(currentState);
      if (shouldReset) {
        await this.resetWorkerState();
        this.logger.log(`Worker ${this.workerId} 任务失败后状态已重置`);
      }
    }
  }

  /**
   * 判断是否应该重置 Worker 状态
   */
  private async shouldResetWorkerState(state: WorkerState): Promise<boolean> {
    // 如果达到最大批次大小，重置状态
    if (state.currentBatchSize >= this.maxBatchSize) {
      this.logger.log(`Worker ${this.workerId} 达到最大批次大小 ${this.maxBatchSize}，需要重置状态`);
      return true;
    }

    // 如果执行队列为空，重置状态
    const queueName = `${this.config.workerQueuePrefix}-${this.workerId}`;
    const waiting = await this.redis.llen(`bull:${queueName}:waiting`);
    const active = await this.redis.llen(`bull:${queueName}:active`);
    
    this.logger.log(`Worker ${this.workerId} 队列状态检查: ${queueName}, 等待: ${waiting}, 活跃: ${active}`);
    
    return waiting === 0 && active === 0;
  }

  /**
   * 重置 Worker 状态
   */
  private async resetWorkerState(): Promise<void> {
    const state: WorkerState = {
      workerId: this.workerId,
      status: 'idle',
      currentIdentifyTag: null,
      currentBatchSize: 0,
    };

    await this.updateWorkerState(state);
    this.logger.log(`Worker ${this.workerId} 状态已重置: ${JSON.stringify(state)}`);
  }

  /**
   * 获取 Worker 状态
   */
  private async getWorkerState(): Promise<WorkerState | null> {
    const key = `${this.config.workerStatePrefix}:${this.workerId}`;
    
    try {
      const data = await this.redis.hgetall(key);
      
      if (!data || !data.workerId) {
        this.logger.warn(`Worker ${this.workerId} 状态不存在: ${key}`);
        return null;
      }

      const state = {
        workerId: data.workerId,
        status: data.status as 'idle' | 'running',
        currentIdentifyTag: data.currentIdentifyTag || null,
        currentBatchSize: parseInt(data.currentBatchSize || '0', 10),
      };

      this.logger.log(`Worker ${this.workerId} 获取状态成功: ${JSON.stringify(state)}`);
      return state;
    } catch (error) {
      this.logger.error(`获取 Worker 状态失败:`, error);
      return null;
    }
  }

  /**
   * 更新 Worker 状态
   */
  private async updateWorkerState(state: WorkerState): Promise<void> {
    const key = `${this.config.workerStatePrefix}:${this.workerId}`;
    
    const data = {
      workerId: state.workerId,
      status: state.status,
      currentIdentifyTag: state.currentIdentifyTag || '',
      currentBatchSize: state.currentBatchSize.toString(),
      lastUpdated: new Date().toISOString(),
    };

    await this.redis.hset(key, data);
    this.logger.log(`Worker ${this.workerId} 状态已更新: ${JSON.stringify(data)}`);
  }

  /**
   * 设置最大批次大小
   */
  setMaxBatchSize(size: number): void {
    this.maxBatchSize = size;
    this.logger.log(`Worker ${this.workerId} 最大批次大小设置为: ${size}`);
  }

  /**
   * 模块销毁时的清理
   */
  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
    this.logger.log(`Worker ${this.workerId} 已停止`);
  }
} 