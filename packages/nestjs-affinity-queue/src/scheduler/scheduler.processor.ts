import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { RedisUtils } from '../common/utils/redis.utils';
import { queueConfig } from '../config/config';
import { SchedulerElectionService } from './scheduler.election';

@Injectable()
export class SchedulerProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerProcessor.name);
  private redis: Redis;
  private schedulerInterval: NodeJS.Timeout;
  private pendingQueue: Queue;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
    private readonly electionService: SchedulerElectionService,
    @Inject('REDIS_OPTIONS')
    private readonly redisOptions: any,
  ) {
    // 使用与 queue.module.ts 相同的 Redis 连接配置
    const connection: any = {
      host: this.redisOptions.host || this.config.redisHost,
      port: this.redisOptions.port || this.config.redisPort,
    };

    // 只有当密码存在时才添加到连接配置中
    if (this.redisOptions.password) {
      connection.password = this.redisOptions.password;
    }

    // 只有当 db 存在且不为 0 时才添加到连接配置中
    if (this.redisOptions.db !== undefined && this.redisOptions.db !== 0) {
      connection.db = this.redisOptions.db;
    }

    this.redis = new Redis(connection);
    // 动态创建队列实例
    this.pendingQueue = new Queue(this.config.pendingQueueName, {
      connection: this.redis,
    });
  }

  async onModuleInit() {
    // 等待选举服务初始化
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 只有当选为领导者时才启动调度功能
    if (this.electionService.isCurrentNodeLeader()) {
      this.logger.log('当前节点为调度器领导者，启动调度功能');
      
      // 恢复孤儿任务
      await this.recoverOrphanedTasks();
      
      // 开始调度循环
      this.startScheduling();
      
      // 启动清理过期 Worker 的定时任务
      this.startCleanupTask();
      
      this.logger.log('调度器已启动');
    } else {
      this.logger.log('当前节点不是调度器领导者，仅作为 Worker 运行');
    }
  }

  /**
   * 恢复孤儿任务
   * 检查所有 Worker 队列，将未完成的任务重新放回调度队列头部
   */
  private async recoverOrphanedTasks(): Promise<void> {
    try {
      this.logger.log('开始检查孤儿任务...');
      
      // 获取所有 Worker 队列
      const workerQueuePattern = `${this.config.workerQueuePrefix}-*`;
      const queueKeys = await RedisUtils.scanKeys(this.redis, workerQueuePattern);
      
      let totalRecoveredTasks = 0;
      
      for (const queueKey of queueKeys) {
        const queueName = queueKey.replace('bull:', ''); // BullMQ 在 Redis 中的键前缀
        const recoveredCount = await this.recoverTasksFromQueue(queueName);
        totalRecoveredTasks += recoveredCount;
      }
      
      if (totalRecoveredTasks > 0) {
        this.logger.log(`成功恢复 ${totalRecoveredTasks} 个孤儿任务到调度队列`);
      } else {
        this.logger.log('未发现需要恢复的孤儿任务');
      }
    } catch (error) {
      this.logger.error('恢复孤儿任务时发生错误:', error);
    }
  }

  /**
   * 从指定的 Worker 队列中恢复任务
   * @param queueName Worker 队列名称
   * @returns 恢复的任务数量
   */
  private async recoverTasksFromQueue(queueName: string): Promise<number> {
    try {
      const workerQueue = new Queue(queueName, { connection: this.redis });
      
      // 获取等待中的任务
      const waitingJobs = await workerQueue.getWaiting();
      // 获取活跃的任务
      const activeJobs = await workerQueue.getActive();
      
      const allJobs = [...waitingJobs, ...activeJobs];
      
      if (allJobs.length === 0) {
        return 0;
      }
      
      this.logger.log(`发现队列 ${queueName} 中有 ${allJobs.length} 个未完成任务`);
      
      let recoveredCount = 0;
      
      // 按优先级排序：活跃任务优先，然后按任务创建时间排序
      const sortedJobs = allJobs.sort((a, b) => {
        // 活跃任务优先
        const aActive = activeJobs.some(job => job.id === a.id);
        const bActive = activeJobs.some(job => job.id === b.id);
        
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        
        // 按创建时间排序（早的优先）
        return a.timestamp - b.timestamp;
      });
      
      for (const job of sortedJobs) {
        try {
          const task = job.data as Task;
          
          // 将任务重新添加到调度队列头部（使用高优先级）
          await this.pendingQueue.add('pending-task', task, {
            priority: 1, // 高优先级，确保优先处理
            delay: 0, // 立即处理
            removeOnComplete: 50,
            removeOnFail: 20,
          });
          
          // 从 Worker 队列中移除任务
          await job.remove();
          
          recoveredCount++;
          this.logger.log(`已恢复任务 ${job.id} (${task.identifyTag}) 从队列 ${queueName}`);
        } catch (error) {
          this.logger.error(`恢复任务 ${job.id} 时发生错误:`, error);
        }
      }
      
      return recoveredCount;
    } catch (error) {
      this.logger.error(`从队列 ${queueName} 恢复任务时发生错误:`, error);
      return 0;
    }
  }

  /**
   * 开始调度循环
   */
  private startScheduling() {
    this.schedulerInterval = setInterval(async () => {
      try {
        // 只有领导者才执行调度
        if (this.electionService.isCurrentNodeLeader()) {
          await this.processScheduling();
        }
      } catch (error) {
        this.logger.error('调度过程中发生错误:', error);
      }
    }, this.config.schedulerInterval);
  }

  /**
   * 启动清理过期 Worker 的定时任务
   */
  private startCleanupTask() {
    this.cleanupInterval = setInterval(async () => {
      try {
        if (this.electionService.isCurrentNodeLeader()) {
          await this.electionService.cleanupExpiredWorkers();
        }
      } catch (error) {
        this.logger.error('清理过期 Worker 时发生错误:', error);
      }
    }, 30000); // 每30秒清理一次
  }

  /**
   * 核心调度处理逻辑
   */
  private async processScheduling() {
    // 获取待调度的任务
    const waitingJobs = await this.pendingQueue.getWaiting();
    
    if (waitingJobs.length === 0) {
      return;
    }

    this.logger.debug(`发现 ${waitingJobs.length} 个待调度任务`);

    // 获取所有 Worker 状态
    const workerStates = await this.getAllWorkerStates();

    // 遍历每个待调度任务
    for (const job of waitingJobs) {
      const task = job.data as Task;
      
      try {
        const assigned = await this.assignTask(task, workerStates, job);
        if (assigned) {
          this.logger.log(`任务 ${job.id} (${task.identifyTag}) 已分配`);
        }
      } catch (error) {
        this.logger.error(`分配任务 ${job.id} 时发生错误:`, error);
      }
    }
  }

  /**
   * 分配任务给合适的 Worker
   * @param task 任务对象
   * @param workerStates 所有 Worker 状态
   * @param job BullMQ Job 对象
   * @returns boolean 是否成功分配
   */
  private async assignTask(
    task: Task,
    workerStates: WorkerState[],
    job: Job,
  ): Promise<boolean> {
    // 1. 强制亲和性检查
    const affinityWorker = workerStates.find(
      worker => worker.currentIdentifyTag === task.identifyTag && worker.status === 'running'
    );

    if (affinityWorker) {
      // 检查批次是否未满
      if (affinityWorker.currentBatchSize < this.config.defaultMaxBatchSize) {
        return await this.assignToWorker(task, affinityWorker, job);
      } else {
        // 批次已满，强制等待
        this.logger.debug(`任务 ${task.identifyTag} 等待 Worker ${affinityWorker.workerId} 完成当前批次`);
        return false;
      }
    }

    // 2. 空闲节点分配
    const idleWorker = workerStates.find(worker => worker.status === 'idle');
    
    if (idleWorker) {
      return await this.assignToWorker(task, idleWorker, job);
    }

    // 3. 保持等待
    this.logger.debug(`任务 ${task.identifyTag} 等待空闲 Worker`);
    return false;
  }

  /**
   * 将任务分配给指定的 Worker
   */
  private async assignToWorker(
    task: Task,
    worker: WorkerState,
    job: Job,
  ): Promise<boolean> {
    try {
      // 获取 Worker 执行队列
      const workerQueueName = `${this.config.workerQueuePrefix}-${worker.workerId}`;
      const workerQueue = new Queue(workerQueueName, {
        connection: this.redis,
      });

      // 将任务添加到 Worker 执行队列
      await workerQueue.add('execute-task', task, {
        removeOnComplete: 50,
        removeOnFail: 20,
      });

      // 更新 Worker 状态
      await this.updateWorkerState(worker.workerId, {
        status: 'running',
        currentIdentifyTag: task.identifyTag,
        currentBatchSize: worker.status === 'idle' ? 1 : worker.currentBatchSize + 1,
      });

      // 从待调度队列中移除任务
      await job.remove();

      return true;
    } catch (error) {
      this.logger.error(`分配任务给 Worker ${worker.workerId} 时发生错误:`, error);
      return false;
    }
  }

  /**
   * 获取所有 Worker 状态
   */
  private async getAllWorkerStates(): Promise<WorkerState[]> {
    const pattern = `${this.config.workerStatePrefix}:*`;
    const keys = await RedisUtils.scanKeys(this.redis, pattern);
    
    const states: WorkerState[] = [];
    
    for (const key of keys) {
      try {
        const data = await this.redis.hgetall(key);
        if (data && data.workerId) {
          states.push({
            workerId: data.workerId,
            status: data.status as 'idle' | 'running',
            currentIdentifyTag: data.currentIdentifyTag || null,
            currentBatchSize: parseInt(data.currentBatchSize || '0', 10),
          });
        }
      } catch (error) {
        this.logger.error(`获取 Worker 状态失败 ${key}:`, error);
      }
    }
    
    return states;
  }

  /**
   * 更新 Worker 状态
   */
  private async updateWorkerState(
    workerId: string,
    updates: Partial<WorkerState>,
  ): Promise<void> {
    const key = `${this.config.workerStatePrefix}:${workerId}`;
    
    const updateData: any = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.currentIdentifyTag !== undefined) {
      updateData.currentIdentifyTag = updates.currentIdentifyTag || '';
    }
    if (updates.currentBatchSize !== undefined) {
      updateData.currentBatchSize = updates.currentBatchSize.toString();
    }

    await this.redis.hset(key, updateData);
  }

  /**
   * 清理资源
   */
  async onModuleDestroy() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    this.logger.log('调度器已停止');
  }
} 