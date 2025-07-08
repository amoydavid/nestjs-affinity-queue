import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { Redis, Cluster } from 'ioredis';
import { Task } from '../common/interfaces/task.interface';
import { WorkerState } from '../common/interfaces/worker-state.interface';
import { RedisUtils } from '../common/utils/redis.utils';
import { SchedulerElectionService } from './scheduler.election';
import { QueueModuleOptions } from '../queue.module';

@Injectable()
export class SchedulerProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private redis: Redis | Cluster;
  private schedulerInterval: NodeJS.Timeout;
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly options: QueueModuleOptions,
    private readonly pendingQueue: Queue,
    private readonly electionService: SchedulerElectionService,
  ) {
    this.logger = new Logger(`${SchedulerProcessor.name}:${this.options.name || 'default'}`);
    this.logger.log(`SchedulerProcessor for "${this.options.name || 'default'}" initialized.`);
  }

  async onModuleInit() {
    this.redis = await this.pendingQueue.client;
    // 等待选举服务初始化
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 只有当选为领导者时才启动调度功能
    if (this.electionService.isCurrentNodeLeader()) {
      this.logger.log('Current node is the scheduler leader, starting scheduling functions.');
      
      // 恢复孤儿任务
      await this.recoverOrphanedTasks();
      
      // 开始调度循环
      this.startScheduling();
      
      // 启动清理过期 Worker 的定时任务
      this.startCleanupTask();
      
      this.logger.log('Scheduler has started.');
    } else {
      this.logger.log('Current node is not the scheduler leader, will run as a worker only.');
    }
  }

  /**
   * 恢复孤儿任务
   * 检查所有 Worker 队列，将未完成的任务重新放回调度队列头部
   */
  private async recoverOrphanedTasks(): Promise<void> {
    // Type guard to ensure we don't pass a Cluster client to a method expecting a Redis client.
    if (this.redis instanceof Cluster) {
        this.logger.error('Redis Cluster is not supported for task recovery at this time.');
        return;
    }

    try {
      this.logger.log('Checking for orphaned tasks by scanning worker states...');
      
      const workerStatePrefix = this.options.queueOptions.workerStatePrefix;
      const stateKeys = await RedisUtils.scanKeys(this.redis, `${workerStatePrefix}:*`);
      
      let totalRecoveredTasks = 0;
      
      for (const stateKey of stateKeys) {
        const workerId = stateKey.substring(stateKey.lastIndexOf(':') + 1);
        if (!workerId) continue;

        const workerQueueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
        const recoveredCount = await this.recoverTasksFromQueue(workerQueueName);
        totalRecoveredTasks += recoveredCount;
      }
      
      if (totalRecoveredTasks > 0) {
        this.logger.log(`Successfully recovered ${totalRecoveredTasks} orphaned tasks to the scheduling queue.`);
      } else {
        this.logger.log('No orphaned tasks found to recover.');
      }
    } catch (error) {
      this.logger.error('Error while recovering orphaned tasks:', error);
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
      
      const waitingJobs = await workerQueue.getWaiting();
      const activeJobs = await workerQueue.getActive();
      
      const allJobs = [...waitingJobs, ...activeJobs];
      
      if (allJobs.length === 0) {
        await workerQueue.close();
        return 0;
      }
      
      this.logger.log(`Found ${allJobs.length} unfinished tasks in queue ${queueName}`);
      
      let recoveredCount = 0;
      
      const sortedJobs = allJobs.sort((a, b) => {
        const aActive = activeJobs.some(job => job.id === a.id);
        const bActive = activeJobs.some(job => job.id === b.id);
        
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        
        return a.timestamp - b.timestamp;
      });
      
      for (const job of sortedJobs) {
        try {
          const task = job.data as Task;
          
          await this.pendingQueue.add('pending-task', task, {
            priority: 1, 
            delay: 0, 
            removeOnComplete: 50,
            removeOnFail: 20,
          });
          
          await job.remove();
          
          recoveredCount++;
          this.logger.log(`Recovered task ${job.id} (${task.identifyTag}) from queue ${queueName}`);
        } catch (error) {
          this.logger.error(`Error recovering task ${job.id}:`, error);
        }
      }
      await workerQueue.close();
      return recoveredCount;
    } catch (error) {
      this.logger.error(`Error recovering tasks from queue ${queueName}:`, error);
      return 0;
    }
  }

  /**
   * 开始调度循环
   */
  private startScheduling() {
    const interval = this.options.queueOptions.schedulerInterval;
    this.schedulerInterval = setInterval(async () => {
      try {
        if (this.electionService.isCurrentNodeLeader()) {
          await this.processScheduling();
        }
      } catch (error) {
        this.logger.error('Error during scheduling process:', error);
      }
    }, interval);
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
        this.logger.error('Error during expired worker cleanup:', error);
      }
    }, 30000); // 每30秒清理一次
  }

  /**
   * 核心调度处理逻辑
   */
  private async processScheduling() {
    const waitingJobs = await this.pendingQueue.getWaiting();
    
    if (waitingJobs.length === 0) {
      return;
    }

    this.logger.debug(`Found ${waitingJobs.length} tasks to schedule.`);

    const workerStates = await this.getAllWorkerStates();

    for (const job of waitingJobs) {
      const task = job.data as Task;
      
      try {
        const assigned = await this.assignTask(task, workerStates, job);
        if (assigned) {
          this.logger.log(`Task ${job.id} (${task.identifyTag}) has been assigned.`);
        }
      } catch (error) {
        this.logger.error(`Error assigning task ${job.id}:`, error);
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
    const affinityWorker = workerStates.find(
      worker => worker.currentIdentifyTag === task.identifyTag && worker.status === 'running'
    );

    if (affinityWorker) {
      const maxBatchSize = this.options.workerOptions.maxBatchSize;
      if (affinityWorker.currentBatchSize < maxBatchSize) {
        return await this.assignToWorker(task, affinityWorker, job);
      } else {
        this.logger.debug(`Task ${task.identifyTag} is waiting for worker ${affinityWorker.workerId} to complete its current batch.`);
        return false;
      }
    }

    const idleWorker = workerStates.find(worker => worker.status === 'idle');
    
    if (idleWorker) {
      return await this.assignToWorker(task, idleWorker, job);
    }

    this.logger.debug(`Task ${task.identifyTag} is waiting for an idle worker.`);
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
      const workerQueuePrefix = this.options.queueOptions.workerQueuePrefix;
      const workerQueueName = `${workerQueuePrefix}-${worker.workerId}`;
      const workerQueue = new Queue(workerQueueName, {
        connection: this.redis,
      });

      await workerQueue.add('execute-task', task, {
        removeOnComplete: 50,
        removeOnFail: 20,
      });
      await workerQueue.close();

      await this.updateWorkerState(worker.workerId, {
        status: 'running',
        currentIdentifyTag: task.identifyTag,
        currentBatchSize: worker.status === 'idle' ? 1 : worker.currentBatchSize + 1,
      });

      await job.remove();

      return true;
    } catch (error) {
      this.logger.error(`Error assigning task to worker ${worker.workerId}:`, error);
      return false;
    }
  }

  /**
   * 获取所有 Worker 状态
   */
  private async getAllWorkerStates(): Promise<WorkerState[]> {
    if (this.redis instanceof Cluster) {
        this.logger.error('Redis Cluster is not supported for getting worker states at this time.');
        return [];
    }
    const workerStatePrefix = this.options.queueOptions.workerStatePrefix;
    const pattern = `${workerStatePrefix}:*`;
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
        this.logger.error(`Failed to get worker state for key ${key}:`, error);
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
    const workerStatePrefix = this.options.queueOptions.workerStatePrefix;
    const key = `${workerStatePrefix}:${workerId}`;
    
    const updateData: any = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.currentIdentifyTag !== undefined) {
      updateData.currentIdentifyTag = updates.currentIdentifyTag || '';
    }
    if (updates.currentBatchSize !== undefined) {
      updateData.currentBatchSize = updates.currentBatchSize.toString();
    }

    if (Object.keys(updateData).length > 0) {
        await this.redis.hset(key, updateData);
    }
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
    
    this.logger.log('Scheduler has stopped.');
  }
}
