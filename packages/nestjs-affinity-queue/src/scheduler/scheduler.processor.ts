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
    
    // 检查是否有其他 Worker 在监听 pendingQueue
    try {
      const queueInfo = await this.pendingQueue.getJobCounts();
      this.logger.log(`pendingQueue 初始状态: ${JSON.stringify(queueInfo)}`);
      
      // 检查是否有 Worker 在监听这个队列
      const workers = await this.pendingQueue.getWorkers();
      if (workers.length > 0) {
        this.logger.warn(`检测到 ${workers.length} 个 Worker 在监听 pendingQueue，这可能导致任务被立即消费`);
      }
    } catch (error) {
      this.logger.error('检查 pendingQueue 状态时发生错误:', error);
    }
    
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

  // /**
  //  * 恢复孤儿任务
  //  * 检查所有 Worker 队列，将未完成的任务重新放回调度队列头部
  //  */
  // private async recoverOrphanedTasks(): Promise<void> {
  //   // Type guard to ensure we don't pass a Cluster client to a method expecting a Redis client.
  //   if (this.redis instanceof Cluster) {
  //       this.logger.error('Redis Cluster is not supported for task recovery at this time.');
  //       return;
  //   }

  //   try {
  //     this.logger.log('Checking for orphaned tasks by scanning worker states...');
      
  //     const workerStatePrefix = this.options.queueOptions.workerStatePrefix;
  //     const stateKeys = await RedisUtils.scanKeys(this.redis, `${workerStatePrefix}:*`);
      
  //     let totalRecoveredTasks = 0;
      
  //     for (const stateKey of stateKeys) {
  //       const workerId = stateKey.substring(stateKey.lastIndexOf(':') + 1);
  //       if (!workerId) continue;

  //       const workerQueueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
  //       const recoveredCount = await this.recoverTasksFromQueue(workerQueueName);
  //       totalRecoveredTasks += recoveredCount;
  //     }
      
  //     if (totalRecoveredTasks > 0) {
  //       this.logger.log(`Successfully recovered ${totalRecoveredTasks} orphaned tasks to the scheduling queue.`);
  //     } else {
  //       this.logger.log('No orphaned tasks found to recover.');
  //     }
  //   } catch (error) {
  //     this.logger.error('Error while recovering orphaned tasks:', error);
  //   }
  // }

  /**
   * 改进的孤儿任务恢复机制
   * 策略：全量扫描 + 延迟清理，避免复杂的状态判断
   */
  private async recoverOrphanedTasks(): Promise<void> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for task recovery at this time.');
      return;
    }

    try {
      this.logger.log('开始恢复孤儿任务（全量扫描模式）...');
      
      // 1. 扫描所有可能的 Worker 队列
      const allWorkerQueues = await this.scanAllWorkerQueues();
      
      let totalRecoveredTasks = 0;
      const emptyQueues: string[] = [];
      const processedQueues: string[] = [];
      
      // 2. 逐个队列处理
      for (const queueName of allWorkerQueues) {
        try {
          const recoveredCount = await this.recoverTasksFromQueue(queueName);
          totalRecoveredTasks += recoveredCount;
          processedQueues.push(queueName);
          
          if (recoveredCount === 0) {
            emptyQueues.push(queueName);
          } else {
            this.logger.log(`从队列 ${queueName} 恢复了 ${recoveredCount} 个任务`);
          }
        } catch (error) {
          this.logger.error(`处理队列 ${queueName} 时发生错误:`, error);
        }
      }
      
      // 3. 延迟清理空队列和过期状态
      this.scheduleCleanupTask(emptyQueues, processedQueues);
      
      if (totalRecoveredTasks > 0) {
        this.logger.log(`✅ 成功恢复 ${totalRecoveredTasks} 个孤儿任务到调度队列`);
      } else {
        this.logger.log('✅ 未发现需要恢复的孤儿任务');
      }
      
    } catch (error) {
      this.logger.error('恢复孤儿任务时发生错误:', error);
    }
  }

  /**
   * 扫描所有可能的 Worker 队列
   */
  private async scanAllWorkerQueues(): Promise<string[]> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for task recovery at this time.');
      return [];
    }
    
    const workerQueuePrefix = this.options.queueOptions.workerQueuePrefix;
    
    try {
      // 扫描 BullMQ 队列的等待队列键（这是 BullMQ 存储队列任务的地方）
      const waitingQueuePattern = `bull:${workerQueuePrefix}-*:waiting`;
      const waitingKeys = await RedisUtils.scanKeys(this.redis as Redis, waitingQueuePattern);
      
      // 扫描 BullMQ 队列的活跃队列键
      const activeQueuePattern = `bull:${workerQueuePrefix}-*:active`;
      const activeKeys = await RedisUtils.scanKeys(this.redis as Redis, activeQueuePattern);
      
      // 扫描 BullMQ 队列的延迟队列键
      const delayedQueuePattern = `bull:${workerQueuePrefix}-*:delayed`;
      const delayedKeys = await RedisUtils.scanKeys(this.redis as Redis, delayedQueuePattern);
      
      // 从所有键中提取队列名称
      const allKeys = [...waitingKeys, ...activeKeys, ...delayedKeys];
      const queueNames = new Set<string>();
      
      for (const key of allKeys) {
        // 从 "bull:queue-name:waiting" 格式中提取队列名称
        const match = key.match(/^bull:(.+?):(waiting|active|delayed)$/);
        if (match) {
          const queueName = match[1];
          // 确保是 Worker 队列
          if (queueName.startsWith(workerQueuePrefix + '-')) {
            queueNames.add(queueName);
          }
        }
      }
      
      const validQueues = Array.from(queueNames);
      
      this.logger.log(`扫描到 ${validQueues.length} 个 Worker 队列: ${validQueues.slice(0, 5).join(', ')}${validQueues.length > 5 ? '...' : ''}`);
      
      return validQueues;
    } catch (error) {
      this.logger.error('扫描 Worker 队列时发生错误:', error);
      return [];
    }
  }

  /**
   * 调度清理任务
   * @param emptyQueues 空队列列表
   * @param processedQueues 已处理的队列列表
   */
  private scheduleCleanupTask(emptyQueues: string[], processedQueues: string[]): void {
    // 延迟清理，给其他节点重启预留时间
    setTimeout(async () => {
      await this.performDelayedCleanup(emptyQueues, processedQueues);
    }, 60000); // 60秒后清理
  }

  /**
   * 执行延迟清理任务
   */
  private async performDelayedCleanup(emptyQueues: string[], processedQueues: string[]): Promise<void> {
    try {
      this.logger.log('开始执行延迟清理任务...');
      
      let cleanedQueues = 0;
      let cleanedStates = 0;
      
      // 1. 清理空队列
      for (const queueName of emptyQueues) {
        try {
          // 再次检查队列是否仍为空
          const queue = new Queue(queueName, { connection: this.redis });
          const counts = await queue.getJobCounts();
          const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);
          
          if (totalJobs === 0) {
            await queue.obliterate({ force: true });
            cleanedQueues++;
            this.logger.log(`清理空队列: ${queueName}`);
          }
          
          await queue.close();
        } catch (error) {
          this.logger.error(`清理队列 ${queueName} 时发生错误:`, error);
        }
      }
      
      // 2. 清理孤儿状态记录
      cleanedStates = await this.cleanupOrphanedStates(processedQueues);
      
      this.logger.log(`清理完成: ${cleanedQueues} 个空队列, ${cleanedStates} 个孤儿状态`);
      
    } catch (error) {
      this.logger.error('延迟清理任务执行失败:', error);
    }
  }

  /**
   * 清理孤儿状态记录
   */
  private async cleanupOrphanedStates(processedQueues: string[]): Promise<number> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for task recovery at this time.');
      return 0;
    }
    
    let cleanedCount = 0;
    
    try {
      // 从处理过的队列名称中提取 Worker ID
      const processedWorkerIds = processedQueues.map(queueName => {
        const prefix = this.options.queueOptions.workerQueuePrefix + '-';
        return queueName.startsWith(prefix) ? queueName.substring(prefix.length) : null;
      }).filter(id => id !== null);
      
      // 清理 Worker 状态记录
      const statePattern = `${this.options.queueOptions.workerStatePrefix}:*`;
      const stateKeys = await RedisUtils.scanKeys(this.redis as Redis, statePattern);
      
      for (const stateKey of stateKeys) {
        const workerId = stateKey.substring(stateKey.lastIndexOf(':') + 1);
        
        if (processedWorkerIds.includes(workerId)) {
          // 检查对应的队列是否已经为空
          const queueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
          const queue = new Queue(queueName, { connection: this.redis });
          
          try {
            const counts = await queue.getJobCounts();
            const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);
            
            if (totalJobs === 0) {
              await (this.redis as Redis).del(stateKey);
              cleanedCount++;
              this.logger.log(`清理孤儿状态: ${workerId}`);
            }
          } finally {
            await queue.close();
          }
        }
      }
      
      // 清理注册表中的孤儿记录
      await this.cleanupOrphanedRegistrations(processedWorkerIds);
      
    } catch (error) {
      this.logger.error('清理孤儿状态时发生错误:', error);
    }
    
    return cleanedCount;
  }

  /**
   * 清理注册表中的孤儿记录
   */
  private async cleanupOrphanedRegistrations(processedWorkerIds: string[]): Promise<void> {
    try {
      const registeredWorkers = await this.electionService.getRegisteredWorkers();
      const now = Date.now();
      const heartbeatTimeout = 60000; // 60秒心跳超时
      
      for (const [workerId, workerData] of registeredWorkers) {
        const isProcessed = processedWorkerIds.includes(workerId);
        const isHeartbeatExpired = (now - workerData.lastHeartbeat) > heartbeatTimeout;
        
        if (isProcessed && isHeartbeatExpired) {
          await this.electionService.removeWorkerFromRegistry(workerId);
          this.logger.log(`清理注册表中的孤儿记录: ${workerId}`);
        }
      }
    } catch (error) {
      this.logger.error('清理孤儿注册记录时发生错误:', error);
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
      const delayedJobs = await workerQueue.getDelayed();
      
      const allJobs = [...waitingJobs, ...activeJobs, ...delayedJobs];
      
      if (allJobs.length === 0) {
        await workerQueue.close();
        return 0;
      }
      
      this.logger.log(`在队列 ${queueName} 中发现未完成任务: 等待=${waitingJobs.length}, 执行中=${activeJobs.length}, 延迟=${delayedJobs.length}`);
      
      let recoveredCount = 0;
      let interruptedJobsCount = 0;
      
      // 按优先级排序：活跃任务 > 等待任务 > 延迟任务
      const sortedJobs = allJobs.sort((a, b) => {
        const aActive = activeJobs.some(job => job.id === a.id);
        const bActive = activeJobs.some(job => job.id === b.id);
        const aDelayed = delayedJobs.some(job => job.id === a.id);
        const bDelayed = delayedJobs.some(job => job.id === b.id);
        
        // 活跃任务优先（这些是被中断的任务，需要优先恢复）
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        
        // 延迟任务最后
        if (aDelayed && !bDelayed) return 1;
        if (!aDelayed && bDelayed) return -1;
        
        // 按时间戳排序
        return a.timestamp - b.timestamp;
      });
      
      for (const job of sortedJobs) {
        try {
          const task = job.data as Task;
          const isInterrupted = activeJobs.some(activeJob => activeJob.id === job.id);
          
          if (isInterrupted) {
            interruptedJobsCount++;
          }
          
          // 验证任务数据的完整性
          if (!task || !task.identifyTag) {
            this.logger.warn(`跳过无效任务 ${job.id}，缺少必要数据`);
            await job.remove();
            continue;
          }
          
          this.logger.log(`恢复任务 ${job.id} (${task.identifyTag}) - 类型: ${isInterrupted ? '🔴 被中断执行' : '⏳ 等待中'}`);
          
          // 为被中断的任务设置更高优先级，确保它们优先被重新执行
          const jobPriority = isInterrupted ? 10 : 0;
          
          const addedJob = await this.pendingQueue.add('pending-task', task, {
            priority: jobPriority,
            delay: 0, 
            removeOnComplete: 50,
            removeOnFail: 20,
          });
          
          this.logger.debug(`任务 ${job.id} (${task.identifyTag}) 已添加到调度队列，新任务ID: ${addedJob.id}，优先级: ${jobPriority}`);
          
          // 等待BullMQ处理
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // 移除原任务
          await job.remove();
          
          recoveredCount++;
          
        } catch (error) {
          this.logger.error(`恢复任务 ${job.id} 时发生错误:`, error);
        }
      }
      
      await workerQueue.close();
      
      if (recoveredCount > 0) {
        this.logger.log(`✅ 从队列 ${queueName} 恢复了 ${recoveredCount} 个任务（其中 ${interruptedJobsCount} 个被中断的执行任务）`);
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
    try {
      // 获取队列中的各种状态的任务
      const waitingJobs = await this.pendingQueue.getWaiting();
      const activeJobs = await this.pendingQueue.getActive();
      const completedJobs = await this.pendingQueue.getCompleted();
      const failedJobs = await this.pendingQueue.getFailed();
      
      // 记录队列状态
      this.logger.debug(`队列状态检查 - 等待: ${waitingJobs.length}, 活跃: ${activeJobs.length}, 完成: ${completedJobs.length}, 失败: ${failedJobs.length}`);
      
      // 检查失败任务，这可能是问题所在
      if (failedJobs.length > 0) {
        this.logger.warn(`发现 ${failedJobs.length} 个失败任务，检查失败原因...`);
        for (const failedJob of failedJobs.slice(0, 3)) { // 只检查前3个
          try {
            this.logger.error(`失败任务 ${failedJob.id} 错误信息: ${failedJob.failedReason}`);
          } catch (error) {
            this.logger.error(`无法获取失败任务信息:`, error);
          }
        }
      }
      
      if (waitingJobs.length === 0) {
        // 即使没有待调度任务，也显示 Worker 状态表格（但频率较低）
        if (Math.random() < 0.1) { // 10% 的概率显示
          await this.logWorkerStatusTable();
        }
        return;
      }

      this.logger.log(`发现 ${waitingJobs.length} 个待调度任务，开始分配...`);

      const workerStates = await this.getAllWorkerStates();
      
      // 显示 Worker 状态表格
      await this.logWorkerStatusTable(workerStates);

      let assignedCount = 0;
      for (const job of waitingJobs) {
        const task = job.data as Task;
        
        try {
          const assigned = await this.assignTask(task, workerStates, job);
          if (assigned) {
            assignedCount++;
            this.logger.log(`任务 ${job.id} (${task.identifyTag}) 已分配给 Worker`);
          } else {
            this.logger.debug(`任务 ${job.id} (${task.identifyTag}) 暂时无法分配`);
          }
        } catch (error) {
          this.logger.error(`分配任务 ${job.id} 时发生错误:`, error);
        }
      }
      
      this.logger.log(`本轮调度完成：${assignedCount}/${waitingJobs.length} 个任务已分配`);
      
      // 如果有任务分配，再次显示更新后的 Worker 状态
      if (assignedCount > 0) {
        this.logger.log('任务分配后的 Worker 状态:');
        const updatedWorkerStates = await this.getAllWorkerStates();
        await this.logWorkerStatusTable(updatedWorkerStates);
      }
      
    } catch (error) {
      this.logger.error('调度处理过程中发生错误:', error);
    }
  }

  /**
   * 以表格形式记录 Worker 状态信息
   */
  private async logWorkerStatusTable(workerStates?: WorkerState[]): Promise<void> {
    try {
      if (!workerStates) {
        workerStates = await this.getAllWorkerStates();
      }
      
      if (workerStates.length === 0) {
        this.logger.log('📊 Worker 状态表格: 无活跃 Worker');
        return;
      }

      // 获取增强的 Worker 信息
      const enhancedWorkers = await this.getEnhancedWorkerInfo(workerStates);

      // 构建表格头
      const table = [
        '┌──────────────────────┬────────┬─────────────────┬───────────┬─────────┬───────────┐',
        '│ Worker ID            │ Status │ Current Tag     │ Batch Size│ Job ID  │ Queue Len │',
        '├──────────────────────┼────────┼─────────────────┼───────────┼─────────┼───────────┤'
      ];

      // 按状态和 identifyTag 排序：running 在前，idle 在后
      const sortedWorkers = enhancedWorkers.sort((a, b) => {
        // 先按状态排序：running > idle
        if (a.status !== b.status) {
          return a.status === 'running' ? -1 : 1;
        }
        // 同状态下按 identifyTag 排序
        const aTag = a.currentIdentifyTag || '';
        const bTag = b.currentIdentifyTag || '';
        return aTag.localeCompare(bTag);
      });

      for (const worker of sortedWorkers) {
        // 截断过长的 Worker ID：前8位...后8位
        const shortWorkerId = this.truncateString(worker.workerId, 20);
        
        const status = worker.status === 'running' ? '🟢 RUN ' : '⚪ IDLE';
        
        // 截断过长的 identifyTag：前7位...后7位
        const currentTag = worker.currentIdentifyTag 
          ? this.truncateString(worker.currentIdentifyTag, 15)
          : '-';
        
        const batchSize = worker.currentBatchSize.toString();
        const jobId = worker.currentJobId || '-';
        const queueLength = worker.queueLength.toString();
        
        // 格式化每一行
        const row = `│ ${shortWorkerId.padEnd(20)} │ ${status} │ ${currentTag.padEnd(15)} │ ${batchSize.padEnd(9)} │ ${jobId.padEnd(7)} │ ${queueLength.padEnd(9)} │`;
        table.push(row);
      }

      table.push('└──────────────────────┴────────┴─────────────────┴───────────┴─────────┴───────────┘');
      
      // 添加统计信息
      const runningCount = workerStates.filter(w => w.status === 'running').length;
      const idleCount = workerStates.filter(w => w.status === 'idle').length;
      const totalBatchSize = workerStates.reduce((sum, w) => sum + w.currentBatchSize, 0);
      const totalQueueLength = enhancedWorkers.reduce((sum, w) => sum + w.queueLength, 0);
      
      // 按 identifyTag 分组统计
      const tagStats = workerStates
        .filter(w => w.currentIdentifyTag)
        .reduce((acc, w) => {
          const tag = w.currentIdentifyTag!;
          acc[tag] = (acc[tag] || 0) + w.currentBatchSize;
          return acc;
        }, {} as Record<string, number>);
      
      const tagStatsStr = Object.keys(tagStats).length > 0 
        ? Object.entries(tagStats).map(([tag, count]) => `${tag}:${count}`).join(', ')
        : '无';

      this.logger.log('📊 Worker 状态表格:');
      table.forEach(line => this.logger.log(line));
      this.logger.log(`📈 统计: 运行中=${runningCount}, 空闲=${idleCount}, 总批次=${totalBatchSize}, 总队列=${totalQueueLength}, 标签分布=[${tagStatsStr}]`);
      
    } catch (error) {
      this.logger.error('生成 Worker 状态表格时发生错误:', error);
    }
  }

  /**
   * 获取增强的 Worker 信息（包括当前 jobId 和队列长度）
   */
  private async getEnhancedWorkerInfo(workerStates: WorkerState[]): Promise<Array<WorkerState & { currentJobId?: string; queueLength: number }>> {
    const enhancedWorkers = [];
    
    for (const worker of workerStates) {
      try {
        const queueName = `${this.options.queueOptions.workerQueuePrefix}-${worker.workerId}`;
        const queue = new Queue(queueName, { connection: this.redis });
        
        // 获取队列长度
        const counts = await queue.getJobCounts('wait', 'active');
        const queueLength = counts.wait + counts.active;
        
        // 获取当前活跃任务的 jobId
        let currentJobId: string | undefined;
        if (worker.status === 'running') {
          const activeJobs = await queue.getActive();
          if (activeJobs.length > 0) {
            currentJobId = activeJobs[0].id?.toString();
          }
        }
        
        await queue.close();
        
        enhancedWorkers.push({
          ...worker,
          currentJobId,
          queueLength
        });
      } catch (error) {
        this.logger.error(`Error getting enhanced info for worker ${worker.workerId}:`, error);
        enhancedWorkers.push({
          ...worker,
          currentJobId: undefined,
          queueLength: 0
        });
      }
    }
    
    return enhancedWorkers;
  }

  /**
   * 截断字符串，保留首尾部分
   */
  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str;
    }
    
    const prefixLength = Math.floor((maxLength - 3) / 2);
    const suffixLength = maxLength - 3 - prefixLength;
    
    return str.substring(0, prefixLength) + '...' + str.substring(str.length - suffixLength);
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

      // 获取Worker的最新状态，避免竞态条件
      const currentWorkerState = await this.getWorkerState(worker.workerId);
      const newBatchSize = currentWorkerState ? 
        (currentWorkerState.status === 'idle' ? 1 : currentWorkerState.currentBatchSize + 1) : 1;

      await this.updateWorkerState(worker.workerId, {
        status: 'running',
        currentIdentifyTag: task.identifyTag,
        currentBatchSize: newBatchSize,
      });

      this.logger.debug(`Worker ${worker.workerId} assigned task ${task.identifyTag}, batch size updated to ${newBatchSize}`);

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
   * 获取单个 Worker 的状态
   */
  private async getWorkerState(workerId: string): Promise<WorkerState | null> {
    if (this.redis instanceof Cluster) {
        this.logger.error('Redis Cluster is not supported for getting worker state at this time.');
        return null;
    }
    
    try {
      const workerStatePrefix = this.options.queueOptions.workerStatePrefix;
      const key = `${workerStatePrefix}:${workerId}`;
      const data = await this.redis.hgetall(key);
      
      if (data && data.workerId) {
        return {
          workerId: data.workerId,
          status: data.status as 'idle' | 'running',
          currentIdentifyTag: data.currentIdentifyTag || null,
          currentBatchSize: parseInt(data.currentBatchSize || '0', 10),
        };
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Failed to get worker state for ${workerId}:`, error);
      return null;
    }
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
