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
  private electionMonitoringInterval: NodeJS.Timeout; // 新增：选举状态监控间隔

  constructor(
    private readonly options: QueueModuleOptions,
    private readonly pendingQueue: Queue,
    private readonly electionService: SchedulerElectionService,
  ) {
    this.logger = new Logger(`${SchedulerProcessor.name}:${this.options.name || 'default'}`);
    this.logger.log(`SchedulerProcessor initialized: ${this.options.name || 'default'}`);
  }

  async onModuleInit() {
    this.redis = await this.pendingQueue.client;
    
    // 等待选举服务初始化
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 启动选举状态监控
    this.startElectionMonitoring();
  }

  /**
   * 启动选举状态监控
   * 定期检查选举状态，动态启动或停止调度功能
   */
  private startElectionMonitoring() {
    let isSchedulerStarted = false;
    
    const checkElectionStatus = async () => {
      try {
        const isLeader = this.electionService.isCurrentNodeLeader();
        
        if (isLeader && !isSchedulerStarted) {
          this.logger.log('🚀 Scheduler leader elected, starting functions');
          
          await this.recoverOrphanedTasks();
          await new Promise(resolve => setTimeout(resolve, 100));
          this.startScheduling();
          this.startCleanupTask();
          
          isSchedulerStarted = true;
          this.logger.log('✅ Scheduler started');
          
        } else if (!isLeader && isSchedulerStarted) {
          this.logger.log('⏹️ Lost scheduler leadership, stopping functions');
          
          if (this.schedulerInterval) {
            clearTimeout(this.schedulerInterval);
            this.schedulerInterval = null;
          }
          
          if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
          }
          
          isSchedulerStarted = false;
          this.logger.log('⏸️ Scheduler stopped');
          
        } else if (!isLeader && !isSchedulerStarted) {
          // 只有在确实没有领导者时才记录日志，避免 follower 节点刷屏
          const leader = await this.electionService.getCurrentLeader();
          if (!leader) {
            this.logger.debug('Waiting for scheduler leadership');
          }
        }
      } catch (error) {
        this.logger.error('检查选举状态时发生错误:', error);
      }
    };
    
    // 立即检查一次
    checkElectionStatus();
    
    // 每2秒检查一次选举状态
    this.electionMonitoringInterval = setInterval(checkElectionStatus, 2000);
  }

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
      this.logger.log('🔍 Scanning for orphaned tasks');
      
      const allWorkerQueues = await this.scanAllWorkerQueues();
      
      let totalRecoveredTasks = 0;
      const emptyQueues: string[] = [];
      const processedQueues: string[] = [];
      
      for (const queueName of allWorkerQueues) {
        try {
          const recoveredCount = await this.recoverTasksFromQueue(queueName);
          totalRecoveredTasks += recoveredCount;
          processedQueues.push(queueName);
          
          if (recoveredCount === 0) {
            emptyQueues.push(queueName);
          } else {
            this.logger.log(`📦 Recovered ${recoveredCount} tasks from ${queueName}`);
          }
        } catch (error) {
          this.logger.error(`处理队列 ${queueName} 时发生错误:`, error);
        }
      }
      
      this.scheduleCleanupTask(emptyQueues, processedQueues);
      
      if (totalRecoveredTasks > 0) {
        this.logger.log(`✅ Recovered ${totalRecoveredTasks} orphaned tasks`);
      } else {
        this.logger.log('✅ No orphaned tasks found');
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
      
      if (validQueues.length > 0) {
        this.logger.debug(`Found ${validQueues.length} worker queues`);
      }
      
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
    }, 12000); // 120秒后清理
  }

  /**
   * 执行延迟清理任务
   */
  private async performDelayedCleanup(emptyQueues: string[], processedQueues: string[]): Promise<void> {
    try {
      this.logger.debug('Starting delayed cleanup task');
      
      let cleanedQueues = 0;
      let cleanedStates = 0;
      
      for (const queueName of emptyQueues) {
        try {
          const queue = new Queue(queueName, { connection: this.redis });
          const counts = await queue.getJobCounts();
          const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);
          
          if (totalJobs === 0) {
            await queue.obliterate({ force: true });
            await this.cleanupQueueRedisKeys(queueName);
            cleanedQueues++;
            this.logger.debug(`Cleaned empty queue: ${queueName}`);
          }
          
          await queue.close();
        } catch (error) {
          this.logger.error(`清理队列 ${queueName} 时发生错误:`, error);
        }
      }
      
      cleanedStates = await this.cleanupOrphanedStates(processedQueues);
      const cleanedGarbageKeys = await this.cleanupGarbageKeys();
      
      if (cleanedQueues > 0 || cleanedStates > 0 || cleanedGarbageKeys > 0) {
        this.logger.log(`🧹 Cleanup: ${cleanedQueues} queues, ${cleanedStates} states, ${cleanedGarbageKeys} keys`);
      }
      
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
   * 清理队列相关的 Redis keys
   */
  private async cleanupQueueRedisKeys(queueName: string): Promise<void> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for queue key cleanup at this time.');
      return;
    }

    try {
      // 清理 BullMQ 队列相关的所有 Redis keys
      const patterns = [
        `bull:${queueName}:*`,
        `bull:${queueName}`,
      ];

      for (const pattern of patterns) {
        const keys = await RedisUtils.scanKeys(this.redis as Redis, pattern);
        if (keys.length > 0) {
          await (this.redis as Redis).del(...keys);
          this.logger.debug(`清理队列 ${queueName} 的 ${keys.length} 个 Redis keys`);
        }
      }
    } catch (error) {
      this.logger.error(`清理队列 ${queueName} 的 Redis keys 时发生错误:`, error);
    }
  }

  /**
   * 清理所有垃圾 keys（孤儿任务、过期队列等）
   */
  private async cleanupGarbageKeys(): Promise<number> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for garbage key cleanup at this time.');
      return 0;
    }

    let cleanedCount = 0;

    try {
      // 获取当前活跃的 Worker IDs
      const activeWorkerIds = await this.getActiveWorkerIds();
      
      // 清理孤儿 Worker 队列相关的 keys
      const workerQueuePattern = `bull:${this.options.queueOptions.workerQueuePrefix}-*`;
      const allWorkerKeys = await RedisUtils.scanKeys(this.redis as Redis, workerQueuePattern);
      
      for (const key of allWorkerKeys) {
        try {
          // 提取 Worker ID
          const match = key.match(new RegExp(`bull:${this.options.queueOptions.workerQueuePrefix}-(.*?):`));
          if (match) {
            const workerId = match[1];
            
            // 如果 Worker 不活跃，检查是否可以清理
            if (!activeWorkerIds.includes(workerId)) {
              const shouldClean = await this.shouldCleanWorkerKey(key, workerId);
              if (shouldClean) {
                await (this.redis as Redis).del(key);
                cleanedCount++;
                this.logger.debug(`清理孤儿 Worker key: ${key}`);
              }
            }
          }
        } catch (error) {
          this.logger.error(`清理 Worker key ${key} 时发生错误:`, error);
        }
      }

      // 清理过期的任务 keys（超过 24 小时的已完成任务）
      const taskKeyPattern = `bull:*:*`;
      const taskKeys = await RedisUtils.scanKeys(this.redis as Redis, taskKeyPattern);
      
      for (const key of taskKeys) {
        try {
          // 检查是否是数字 key（任务 ID）
          const parts = key.split(':');
          if (parts.length === 3 && !isNaN(parseInt(parts[2]))) {
            const shouldClean = await this.shouldCleanTaskKey(key);
            if (shouldClean) {
              await (this.redis as Redis).del(key);
              cleanedCount++;
              this.logger.debug(`清理过期任务 key: ${key}`);
            }
          }
        } catch (error) {
          this.logger.error(`清理任务 key ${key} 时发生错误:`, error);
        }
      }

    } catch (error) {
      this.logger.error('清理垃圾 keys 时发生错误:', error);
    }

    return cleanedCount;
  }

  /**
   * 获取当前活跃的 Worker IDs
   */
  private async getActiveWorkerIds(): Promise<string[]> {
    try {
      const registeredWorkers = await this.electionService.getRegisteredWorkers();
      const now = Date.now();
      const heartbeatTimeout = 60000; // 60秒心跳超时
      
      return Array.from(registeredWorkers.entries())
        .filter(([, workerData]) => (now - workerData.lastHeartbeat) <= heartbeatTimeout)
        .map(([workerId]) => workerId);
    } catch (error) {
      this.logger.error('获取活跃 Worker IDs 时发生错误:', error);
      return [];
    }
  }

  /**
   * 判断是否应该清理 Worker key
   */
  private async shouldCleanWorkerKey(_key: string, workerId: string): Promise<boolean> {
    try {
      // 双重检查：在决定清理之前，再次确认 Worker 是否处于非活跃状态，以防止竞态条件
      const activeWorkerIds = await this.getActiveWorkerIds();
      if (activeWorkerIds.includes(workerId)) {
        this.logger.debug(`检测到 Worker ${workerId} 已重新变为活跃状态，跳过清理 key: ${_key}`);
        return false;
      }

      // 检查对应的队列是否存在且为空
      const queueName = `${this.options.queueOptions.workerQueuePrefix}-${workerId}`;
      const queue = new Queue(queueName, { connection: this.redis });
      
      try {
        const counts = await queue.getJobCounts();
        const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);
        return totalJobs === 0;
      } finally {
        await queue.close();
      }
    } catch (error) {
      // 如果队列不存在或出错，可以清理
      return true;
    }
  }

  /**
   * 判断是否应该清理任务 key
   */
  private async shouldCleanTaskKey(key: string): Promise<boolean> {
    try {
      // 检查 key 的 TTL
      const ttl = await (this.redis as Redis).ttl(key);
      
      // 如果没有设置 TTL 或 TTL 过长，检查 key 的内容
      if (ttl === -1 || ttl > 86400) { // 超过 24 小时
        const data = await (this.redis as Redis).hgetall(key);
        
        // 如果是已完成的任务且超过 24 小时，可以清理
        if (data && data.finishedOn) {
          const finishedTime = parseInt(data.finishedOn);
          const now = Date.now();
          return (now - finishedTime) > 86400000; // 24 小时
        }
      }
      
      return false;
    } catch (error) {
      // 出错时不清理，避免误删
      return false;
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
      const prioritizedJobs = await workerQueue.getJobs(['prioritized'], 0, -1);
      const pausedJobs = await workerQueue.getJobs(['paused'], 0, -1);
      
      const allJobs = [...waitingJobs, ...activeJobs, ...delayedJobs, ...prioritizedJobs, ...pausedJobs];
      
      if (allJobs.length === 0) {
        // 即使没有任务，也要清理空队列和状态
        await this.cleanupQueueAndState(workerQueue, queueName);
        await workerQueue.close();
        return 0;
      }
      
      this.logger.log(`在队列 ${queueName} 中发现未完成任务: 等待=${waitingJobs.length}, 执行中=${activeJobs.length}, 延迟=${delayedJobs.length}, 优先级=${prioritizedJobs.length}, 暂停=${pausedJobs.length}`);
      
      let recoveredCount = 0;
      let skippedCount = 0;
      let interruptedJobsCount = 0;
      
      // 按优先级排序：活跃任务 > 优先级任务 > 等待任务 > 延迟任务 > 暂停任务
      const sortedJobs = allJobs.sort((a, b) => {
        const aActive = activeJobs.some(job => job.id === a.id);
        const bActive = activeJobs.some(job => job.id === b.id);
        const aPrioritized = prioritizedJobs.some(job => job.id === a.id);
        const bPrioritized = prioritizedJobs.some(job => job.id === b.id);
        const aDelayed = delayedJobs.some(job => job.id === a.id);
        const bDelayed = delayedJobs.some(job => job.id === b.id);
        const aPaused = pausedJobs.some(job => job.id === a.id);
        const bPaused = pausedJobs.some(job => job.id === b.id);
        
        // 活跃任务优先（这些是被中断的任务，需要优先恢复）
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        
        // 优先级任务次之
        if (aPrioritized && !bPrioritized) return -1;
        if (!aPrioritized && bPrioritized) return 1;
        
        // 暂停任务和延迟任务最后
        if (aPaused && !bPaused) return 1;
        if (!aPaused && bPaused) return -1;
        
        if (aDelayed && !bDelayed) return 1;
        if (!aDelayed && bDelayed) return -1;
        
        // 按时间戳排序
        return a.timestamp - b.timestamp;
      });
      
      for (const job of sortedJobs) {
        try {
          const task = job.data as Task;
          const isInterrupted = activeJobs.some(activeJob => activeJob.id === job.id);
          const isPrioritized = prioritizedJobs.some(prioritizedJob => prioritizedJob.id === job.id);
          const isPaused = pausedJobs.some(pausedJob => pausedJob.id === job.id);
          const isDelayed = delayedJobs.some(delayedJob => delayedJob.id === job.id);
          
          if (isInterrupted) {
            interruptedJobsCount++;
          }
          
          // 验证任务数据的完整性
          if (!task || !task.identifyTag) {
            this.logger.warn(`跳过无效任务 ${job.id}，缺少必要数据: ${JSON.stringify(task)}`);
            await job.remove();
            skippedCount++;
            continue;
          }
          
          let taskStatus = '';
          if (isInterrupted) taskStatus = '🔴 被中断执行';
          else if (isPrioritized) taskStatus = '🟡 高优先级等待';
          else if (isPaused) taskStatus = '⏸️ 暂停中';
          else if (isDelayed) taskStatus = '⏱️ 延迟执行';
          else taskStatus = '⏳ 等待中';
          
          this.logger.log(`恢复任务 ${job.id} (${task.identifyTag}) - 类型: ${taskStatus}`);
          
          // 为不同状态的任务设置适当的优先级
          let jobPriority = 0;
          if (isInterrupted) jobPriority = 10; // 被中断的任务最高优先级
          else if (isPrioritized) jobPriority = 5; // 保持原有优先级任务的中等优先级
          else jobPriority = 0; // 其他任务默认优先级
          
          let addedJob: Job | null = null;
          try {
            addedJob = await this.pendingQueue.add('pending-task', task, {
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
            
          } catch (recoveryError) {
            // 3. 如果移除失败，进行错误处理
            if (recoveryError instanceof Error && recoveryError.message.includes('is locked by another worker')) {
              // 这是预期的竞态条件，旧 Worker 仍在处理任务
              this.logger.warn(`任务 ${job.id} (${task.identifyTag}) 仍被锁定，可能是旧 Worker 仍在运行。将跳过本次恢复，等待锁释放。`);
              // 最关键的一步：移除刚才重复添加的任务，防止任务重复执行
              if (addedJob) {
                try {
                  await addedJob.remove();
                  this.logger.log(`已从调度队列中移除为恢复任务 ${job.id} 而预添加的重复任务 ${addedJob.id}`);
                } catch (removeError) {
                  this.logger.error(`无法移除为恢复任务 ${job.id} 而添加的重复任务 ${addedJob.id}，可能导致任务重复执行:`, removeError);
                }
              }
            } else {
              // 其他未知错误
              this.logger.error(`将任务 ${job.id} (${task.identifyTag}) 移动到调度队列时失败:`, recoveryError);
              skippedCount++;
               // 同样需要尝试移除，以防万一
               if (addedJob) {
                try {
                  await addedJob.remove();
                  this.logger.log(`已从调度队列中移除为恢复任务 ${job.id} 而预添加的重复任务 ${addedJob.id}`);
                } catch (removeError) {
                  this.logger.error(`无法移除为恢复任务 ${job.id} 而添加的重复任务 ${addedJob.id}，可能导致任务重复执行:`, removeError);
                }
              }
            }
          }
          
        } catch (error) {
          this.logger.error(`恢复任务 ${job.id} 时发生错误:`, error);
        }
      }
      
      // 任务恢复完成后，立即清理空队列和对应的 Worker 状态
      if (recoveredCount > 0) {
        await this.cleanupQueueAndState(workerQueue, queueName);
        this.logger.log(`✅ 从队列 ${queueName} 恢复了 ${recoveredCount} 个任务（其中 ${interruptedJobsCount} 个被中断的执行任务${skippedCount > 0 ? `，跳过 ${skippedCount} 个无效任务` : ''}）`);
      } else if (skippedCount > 0) {
        await this.cleanupQueueAndState(workerQueue, queueName);
        this.logger.warn(`⚠️ 队列 ${queueName} 中跳过了 ${skippedCount} 个无效任务，未恢复任何有效任务`);
      }
      
      await workerQueue.close();
      
      return recoveredCount;
    } catch (error) {
      this.logger.error(`从队列 ${queueName} 恢复任务时发生错误:`, error);
      return 0;
    }
  }

  /**
   * 立即清理空队列和对应的 Worker 状态
   * @param workerQueue 队列实例
   * @param queueName 队列名称
   */
  private async cleanupQueueAndState(workerQueue: Queue, queueName: string): Promise<void> {
    try {
      // 1. 验证队列已经为空
      const finalCounts = await workerQueue.getJobCounts();
      const totalJobs = Object.values(finalCounts).reduce((sum, count) => sum + count, 0);
      
      if (totalJobs === 0) {
        // 2. 立即删除空队列，清理所有相关的 Redis 键
        await workerQueue.obliterate({ force: true });
        this.logger.log(`🗑️ 已清理空队列: ${queueName}`);
        
        // 3. 清理对应的 Worker 状态
        const workerId = this.extractWorkerIdFromQueueName(queueName);
        if (workerId) {
          await this.cleanupWorkerStateImmediate(workerId);
          this.logger.log(`🗑️ 已清理 Worker 状态: ${workerId}`);
          
          // 4. 从注册表中移除 Worker
          await this.electionService.removeWorkerFromRegistry(workerId);
          this.logger.log(`🗑️ 已从注册表移除 Worker: ${workerId}`);
        }
      } else {
        this.logger.warn(`队列 ${queueName} 恢复后仍有 ${totalJobs} 个任务，跳过清理`);
      }
    } catch (error) {
      this.logger.error(`清理队列和状态时发生错误 ${queueName}:`, error);
    }
  }

  /**
   * 从队列名称中提取 Worker ID
   * @param queueName 队列名称
   * @returns Worker ID 或 null
   */
  private extractWorkerIdFromQueueName(queueName: string): string | null {
    const prefix = this.options.queueOptions.workerQueuePrefix + '-';
    if (queueName.startsWith(prefix)) {
      return queueName.substring(prefix.length);
    }
    return null;
  }

  /**
   * 立即清理 Worker 状态记录
   * @param workerId Worker ID
   */
  private async cleanupWorkerStateImmediate(workerId: string): Promise<void> {
    if (this.redis instanceof Cluster) {
      this.logger.error('Redis Cluster is not supported for worker state cleanup.');
      return;
    }
    
    try {
      const stateKey = `${this.options.queueOptions.workerStatePrefix}:${workerId}`;
      await (this.redis as Redis).del(stateKey);
      this.logger.debug(`已删除 Worker 状态键: ${stateKey}`);
    } catch (error) {
      this.logger.error(`清理 Worker 状态时发生错误 ${workerId}:`, error);
    }
  }

  /**
   * 开始调度循环
   * 使用 setTimeout 确保串行执行，避免并发调度问题
   */
  private startScheduling() {
    const interval = this.options.queueOptions.schedulerInterval;
    
    const scheduleNext = async () => {
      try {
        if (this.electionService.isCurrentNodeLeader()) {
          await this.processScheduling();
        }
      } catch (error) {
        this.logger.error('Error during scheduling process:', error);
      } finally {
        // 无论成功还是失败，都安排下一次调度
        this.schedulerInterval = setTimeout(scheduleNext, interval);
      }
    };
    
    // 启动第一次调度
    this.schedulerInterval = setTimeout(scheduleNext, interval);
  }

  /**
   * 启动清理过期 Worker 的定时任务
   */
  private startCleanupTask() {
    this.cleanupInterval = setInterval(async () => {
      try {
        if (this.electionService.isCurrentNodeLeader()) {
          await this.electionService.cleanupExpiredWorkers();
          
          // 每次清理时也清理垃圾 keys
          const cleanedKeys = await this.cleanupGarbageKeys();
          if (cleanedKeys > 0) {
            this.logger.log(`定期清理完成: ${cleanedKeys} 个垃圾 keys`);
          }
        }
      } catch (error) {
        this.logger.error('Error during cleanup task:', error);
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
      const prioritizedJobs = await this.pendingQueue.getJobs(['prioritized'], 0, -1);
      
      // 合并等待任务和优先级任务
      const allWaitingJobs = [...waitingJobs, ...prioritizedJobs];
      
      if (allWaitingJobs.length === 0) {
        // 即使没有待调度任务，也显示 Worker 状态表格（但频率较低）
        if (Math.random() < 0.1) { // 10% 的概率显示
          await this.logWorkerStatusTable();
        }
        return;
      }

      this.logger.log(`发现 ${allWaitingJobs.length} 个待调度任务（等待: ${waitingJobs.length}, 优先级: ${prioritizedJobs.length}），开始分配...`);

      const workerStates = await this.getAllWorkerStates();
      
      // 显示 Worker 状态表格
      await this.logWorkerStatusTable(workerStates);

      let assignedCount = 0;
      
      // 按优先级排序，优先级高的任务先分配
      const sortedJobs = allWaitingJobs.sort((a, b) => {
        const aPriority = a.opts?.priority || 0;
        const bPriority = b.opts?.priority || 0;
        return bPriority - aPriority; // 降序，优先级高的在前
      });
      
      for (const job of sortedJobs) {
        const task = job.data as Task;
        try {
          const realTimeWorkerStates = await this.getAllWorkerStates();
          const assigned = await this.assignTask(task, realTimeWorkerStates, job);
          if (assigned) {
            assignedCount++;
          }
        } catch (error) {
          this.logger.error(`分配任务 ${job.id} 时发生错误:`, error);
        }
      }
      
      // this.logger.log(`本轮调度完成：${assignedCount}/${allWaitingJobs.length} 个任务已分配`);
      
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
        '│ Worker ID            │ Status │ Current Tag     │ Batch Cnt │ Job ID  │ Queue Len │',
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
      
      // 按 identifyTag 分组统计（包含并发信息）
      const tagStats = workerStates
        .filter(w => w.currentIdentifyTag)
        .reduce((acc, w) => {
          const tag = w.currentIdentifyTag!;
          if (!acc[tag]) {
            acc[tag] = { batchCount: 0, runningWorkers: 0, maxConcurrency: this.getIdentifyTagConcurrency(tag) };
          }
          acc[tag].batchCount += w.currentBatchSize;
          if (w.status === 'running') {
            acc[tag].runningWorkers++;
          }
          return acc;
        }, {} as Record<string, { batchCount: number; runningWorkers: number; maxConcurrency: number }>);
      
      const tagStatsStr = Object.keys(tagStats).length > 0 
        ? Object.entries(tagStats).map(([tag, stats]) => 
            `${tag}:${stats.batchCount}(${stats.runningWorkers}/${stats.maxConcurrency})`
          ).join(', ')
        : '无';

      this.logger.log('📊 Worker 状态表格:');
      table.forEach(line => this.logger.log(line));
      this.logger.log(`📈 统计: 运行中=${runningCount}, 空闲=${idleCount}, 总批次计数=${totalBatchSize}, 实时队列总长=${totalQueueLength}, 标签分布=[${tagStatsStr}]`);
      this.logger.log('💡 说明: Batch Cnt=已分配任务累计数, Queue Len=当前队列实际任务数');
      
    } catch (error) {
      this.logger.error('生成 Worker 状态表格时发生错误:', error);
    }
  }

  /**
   * 获取增强的 Worker 信息（包括当前 jobId 和实时队列长度）
   */
  private async getEnhancedWorkerInfo(workerStates: WorkerState[]): Promise<Array<WorkerState & { currentJobId?: string; queueLength: number }>> {
    const enhancedWorkers = [];
    
    for (const worker of workerStates) {
      try {
        const queueName = `${this.options.queueOptions.workerQueuePrefix}-${worker.workerId}`;
        const queue = new Queue(queueName, { connection: this.redis });
        
        // 获取实时队列长度
        const allCounts = await queue.getJobCounts();
        const queueLength = (allCounts.waiting || 0) + (allCounts.active || 0) + (allCounts.delayed || 0) + (allCounts.prioritized || 0) + (allCounts.paused || 0);
        
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
          queueLength // 实时队列长度，表示当前正在处理和等待的任务数
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
    // 检查 identifyTag 并发数限制
    const maxConcurrency = this.getIdentifyTagConcurrency(task.identifyTag);
    const currentRunningCount = this.getRunningWorkerCountForTag(task.identifyTag, workerStates);
    
    // 如果运行中的 worker 数量小于并发数限制，优先分配空闲 worker
    if (currentRunningCount < maxConcurrency) {
      const idleWorker = workerStates.find(worker => worker.status === 'idle');
      
      if (idleWorker) {
        return await this.assignToWorker(task, idleWorker, job);
      }
    }
    
    // 如果没有空闲 worker 或已达到并发限制，尝试复用现有 worker
    const maxBatchSize = this.options.workerOptions.maxBatchSize;
    const affinityWorkers = workerStates.filter(
      worker => worker.currentIdentifyTag === task.identifyTag && worker.status === 'running' && worker.currentBatchSize < maxBatchSize
    );

    if (affinityWorkers.length > 0) {
      // 优先复用 currentBatchSize 最小的 worker
      const selectedWorker = affinityWorkers.reduce((minWorker, currentWorker) => 
        currentWorker.currentBatchSize < minWorker.currentBatchSize ? currentWorker : minWorker
      );
      
      return await this.assignToWorker(task, selectedWorker, job);
    }

    return false;
  }

  /**
   * 获取指定 identifyTag 的并发数配置
   * @param identifyTag 标识标签
   * @returns 并发数
   */
  private getIdentifyTagConcurrency(identifyTag: string): number {
    const concurrencyConfig = this.options.queueOptions?.identifyTagConcurrency;
    
    if (!concurrencyConfig) {
      return 1; // 默认并发数为 1
    }
    
    // 如果是数字，直接返回
    if (typeof concurrencyConfig === 'number') {
      return concurrencyConfig;
    }
    
    // 如果是对象配置
    if (typeof concurrencyConfig === 'object') {
      // 检查是否有 default 属性
      if ('default' in concurrencyConfig) {
        const config = concurrencyConfig as { default: number; [key: string]: number };
        return config[identifyTag] !== undefined ? config[identifyTag] : config.default;
      } else {
        // 纯粹的 Record<string, number> 配置
        const config = concurrencyConfig as Record<string, number>;
        return config[identifyTag] !== undefined ? config[identifyTag] : 1;
      }
    }
    
    return 1; // 默认值
  }

  /**
   * 获取指定 identifyTag 当前运行中的 worker 数量
   * @param identifyTag 标识标签
   * @param workerStates 所有 worker 状态
   * @returns 运行中的 worker 数量
   */
  private getRunningWorkerCountForTag(identifyTag: string, workerStates: WorkerState[]): number {
    return workerStates.filter(
      worker => worker.currentIdentifyTag === identifyTag && worker.status === 'running'
    ).length;
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

      this.logger.debug(`JOB: ${job.id} | Worker ${worker.workerId} | ${task.identifyTag} -> ${workerQueueName} task: ${JSON.stringify(task)}`);

      await workerQueue.add('execute-task', task, {
        removeOnComplete: 50,
        removeOnFail: 20,
      });
      
      await workerQueue.close();

      // 获取最新的 Worker 状态，然后累加 currentBatchSize
      const currentState = await this.getWorkerStateFromRedis(worker.workerId);
      const currentBatchSize = currentState ? currentState.currentBatchSize : worker.currentBatchSize;
      const newBatchSize = currentBatchSize + 1;
      
      await this.updateWorkerState(worker.workerId, {
        status: 'running',
        currentIdentifyTag: task.identifyTag,
        currentBatchSize: newBatchSize,
      });

      this.logger.debug(`Worker ${worker.workerId} assigned task ${task.identifyTag}, batch size increased from ${currentBatchSize} to: ${newBatchSize}`);

      await job.remove();

      return true;
    } catch (error) {
      this.logger.error(`Error assigning task to worker ${worker.workerId}:`, error);
      return false;
    }
  }

  /**
   * 从 Redis 获取 Worker 状态
   */
  private async getWorkerStateFromRedis(workerId: string): Promise<WorkerState | null> {
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
      this.logger.error(`Failed to get worker state from Redis for ${workerId}:`, error);
      return null;
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
          // currentBatchSize 是累积计数器，从 Redis 获取存储的值
          const currentBatchSize = parseInt(data.currentBatchSize || '0', 10);
          
          states.push({
            workerId: data.workerId,
            status: data.status as 'idle' | 'running',
            currentIdentifyTag: data.currentIdentifyTag || null,
            currentBatchSize: isNaN(currentBatchSize) ? 0 : currentBatchSize,
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
    this.logger.log('开始 SchedulerProcessor 优雅关闭...');
    
    if (this.schedulerInterval) {
      clearTimeout(this.schedulerInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    if (this.electionMonitoringInterval) {
      clearInterval(this.electionMonitoringInterval);
    }
    
    this.logger.log('SchedulerProcessor 已停止');
  }
}
