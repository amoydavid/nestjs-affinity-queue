import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

export interface SchedulerElectionOptions {
  /**
   * 选举锁的过期时间（毫秒）
   */
  electionLockTtl?: number;
  
  /**
   * 心跳间隔（毫秒）
   */
  heartbeatInterval?: number;
  
  /**
   * 心跳超时时间（毫秒）
   */
  heartbeatTimeout?: number;

  /**
   * 队列名称，用于隔离不同队列的选举
   */
  queueName?: string;
}

@Injectable()
export class SchedulerElectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private redis: Redis;
  private nodeId: string;
  private isLeader = false;
  private heartbeatInterval: NodeJS.Timeout;
  private electionLockTtl: number;
  private heartbeatIntervalMs: number;
  private heartbeatTimeout: number;
  private readonly queueName: string;
  private readonly prefix: string;
  private ownRedisConnection = false; // 标记是否是自己创建的连接

  // Redis 键名 getter - 包含队列名称以实现隔离
  private get ELECTION_LOCK_KEY() { return `${this.prefix}:election:lock`; }
  private get LEADER_INFO_KEY() { return `${this.prefix}:leader:info`; }
  private get WORKER_REGISTRY_KEY() { return `${this.prefix}:worker:registry`; }

  constructor(
    options: SchedulerElectionOptions = {},
    redisOptionsOrConnection: any,
  ) {
    this.queueName = options.queueName || 'default';
    this.prefix = `affinity-queue:scheduler:${this.queueName}`;
    this.logger = new Logger(`${SchedulerElectionService.name}:${this.queueName}`);

    // 检查传入的是 Redis 连接还是配置
    if (redisOptionsOrConnection && typeof redisOptionsOrConnection.get === 'function') {
      // 传入的是已有的 Redis 连接
      this.redis = redisOptionsOrConnection;
      this.ownRedisConnection = false;
    } else {
      // 传入的是 Redis 配置，需要创建新连接
      const connection: any = {
        host: redisOptionsOrConnection.host || 'localhost',
        port: redisOptionsOrConnection.port || 6379,
      };

      if (redisOptionsOrConnection.password) {
        connection.password = redisOptionsOrConnection.password;
      }

      if (redisOptionsOrConnection.db !== undefined && redisOptionsOrConnection.db !== 0) {
        connection.db = redisOptionsOrConnection.db;
      }

      connection.maxRetriesPerRequest = null;

      this.redis = new Redis(connection);
      this.ownRedisConnection = true;
    }

    this.nodeId = this.generateNodeId();
    
    // Set default values with faster election
    this.electionLockTtl = options.electionLockTtl || 10000; // 减少到 10 秒
    this.heartbeatIntervalMs = options.heartbeatInterval || 3000; // 减少到 3 秒  
    this.heartbeatTimeout = options.heartbeatTimeout || 15000; // 减少到 15 秒
  }

  async onModuleInit() {
    this.logger.log(`节点 ${this.nodeId} 开始参与调度器选举`);
    await this.startElection();
  }

  async onModuleDestroy() {
    await this.stopElection();
    // 只有在自己创建连接时才关闭它
    if (this.redis && this.ownRedisConnection) {
      try {
        if (this.redis.status === 'ready') {
          await this.redis.quit();
          this.logger.log(`Redis connection closed for ${this.queueName}`);
        }
      } catch (error) {
        // 忽略连接已关闭的错误
        if (error.message && !error.message.includes('Connection is closed')) {
          this.logger.error(`Error closing Redis connection for ${this.queueName}:`, error);
        }
      }
    }
  }

  /**
   * 生成唯一的节点ID
   */
  private generateNodeId(): string {
    const hostname = require('os').hostname().replace(/[^a-zA-Z0-9]/g, '');
    const processId = process.pid;
    const timestamp = Date.now();
    return `node-${hostname}-${processId}-${timestamp}`;
  }

  /**
   * 开始选举过程
   */
  private async startElection() {
    // 立即尝试成为领导者
    await this.tryBecomeLeader();
    
    // 启动心跳机制
    this.startHeartbeat();
  }

  /**
   * 尝试成为领导者
   */
  private async tryBecomeLeader(): Promise<boolean> {
    try {
      // 使用 Redis SET 命令的 NX 和 EX 选项实现分布式锁
      const result = await this.redis.set(
        this.ELECTION_LOCK_KEY,
        this.nodeId,
        'EX',
        Math.floor(this.electionLockTtl / 1000),
        'NX'
      );

      if (result === 'OK') {
        // 成功获得锁，成为领导者
        this.isLeader = true;
        await this.setLeaderInfo();
        this.logger.log(`节点 ${this.nodeId} 成为调度器领导者`);
        return true;
      } else {
        // 未能获得锁，检查当前领导者是否还活着
        await this.checkLeaderHealth();
        return false;
      }
    } catch (error) {
      this.logger.error('尝试成为领导者时发生错误:', error);
      return false;
    }
  }

  /**
   * 检查当前领导者是否还活着
   */
  private async checkLeaderHealth(): Promise<void> {
    try {
      const leaderInfo = await this.redis.get(this.LEADER_INFO_KEY);
      if (!leaderInfo) {
        // 没有领导者信息，尝试成为领导者
        await this.tryBecomeLeader();
        return;
      }

      const leaderData = JSON.parse(leaderInfo);
      const now = Date.now();
      
      // 检查心跳是否超时
      if (now - leaderData.lastHeartbeat > this.heartbeatTimeout) {
        this.logger.log(`领导者 ${leaderData.nodeId} 心跳超时，尝试接管`);
        // 领导者心跳超时，锁应该也快过期了，直接尝试成为领导者
        // tryBecomeLeader 内部会处理 SET NX，是原子操作
        await this.tryBecomeLeader();
      }
    } catch (error) {
      this.logger.error('检查领导者健康状态时发生错误:', error);
    }
  }

  /**
   * 设置领导者信息
   */
  private async setLeaderInfo(): Promise<void> {
    const leaderInfo = {
      nodeId: this.nodeId,
      hostname: require('os').hostname(),
      processId: process.pid,
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
    };

    await this.redis.set(
      this.LEADER_INFO_KEY,
      JSON.stringify(leaderInfo),
      'EX',
      Math.floor(this.heartbeatTimeout / 1000)
    );
  }

  /**
   * 更新领导者心跳
   */
  private async updateHeartbeat(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    try {
      const leaderInfo = await this.redis.get(this.LEADER_INFO_KEY);
      if (leaderInfo) {
        const data = JSON.parse(leaderInfo);
        data.lastHeartbeat = Date.now();
        
        await this.redis.set(
          this.LEADER_INFO_KEY,
          JSON.stringify(data),
          'EX',
          Math.floor(this.heartbeatTimeout / 1000)
        );

        // 续期选举锁
        await this.redis.expire(this.ELECTION_LOCK_KEY, Math.floor(this.electionLockTtl / 1000));
      }
    } catch (error) {
      this.logger.error('更新心跳时发生错误:', error);
      // 心跳失败，可能失去领导权
      this.isLeader = false;
    }
  }

  /**
   * 启动心跳机制
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isLeader) {
        await this.updateHeartbeat();
      } else {
        // 非领导者定期检查是否可以成为领导者
        await this.checkLeaderHealth();
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * 停止选举过程
   */
  private async stopElection() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.isLeader) {
      // 如果是领导者，释放锁
      await this.redis.del(this.ELECTION_LOCK_KEY);
      await this.redis.del(this.LEADER_INFO_KEY);
      this.logger.log(`节点 ${this.nodeId} 释放领导者身份`);
    }
  }

  /**
   * 注册 Worker 节点
   */
  async registerWorker(workerId: string, workerInfo: any): Promise<void> {
    try {
      const workerData = {
        ...workerInfo,
        registeredAt: Date.now(),
        lastHeartbeat: Date.now(),
      };

      await this.redis.hset(
        this.WORKER_REGISTRY_KEY,
        workerId,
        JSON.stringify(workerData)
      );
      
      this.logger.debug(`Worker ${workerId} 已注册`);
    } catch (error) {
      this.logger.error(`注册 Worker ${workerId} 时发生错误:`, error);
    }
  }

  /**
   * 更新 Worker 心跳
   */
  async updateWorkerHeartbeat(workerId: string): Promise<void> {
    try {
      const workerData = await this.redis.hget(this.WORKER_REGISTRY_KEY, workerId);
      if (workerData) {
        const data = JSON.parse(workerData);
        data.lastHeartbeat = Date.now();
        
        await this.redis.hset(
          this.WORKER_REGISTRY_KEY,
          workerId,
          JSON.stringify(data)
        );
      }
    } catch (error) {
      this.logger.error(`更新 Worker ${workerId} 心跳时发生错误:`, error);
    }
  }

  /**
   * 获取所有注册的 Worker
   */
  async getRegisteredWorkers(): Promise<Map<string, any>> {
    try {
      const workers = await this.redis.hgetall(this.WORKER_REGISTRY_KEY);
      const result = new Map<string, any>();
      
      for (const [workerId, workerData] of Object.entries(workers)) {
        try {
          result.set(workerId, JSON.parse(workerData as string));
        } catch (error) {
          this.logger.error(`解析 Worker ${workerId} 数据时发生错误:`, error);
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error('获取注册的 Worker 时发生错误:', error);
      return new Map();
    }
  }

  /**
   * 清理过期的 Worker 注册
   */
  async cleanupExpiredWorkers(): Promise<void> {
    try {
      const workers = await this.getRegisteredWorkers();
      const now = Date.now();
      
      for (const [workerId, workerData] of workers.entries()) {
        if (now - workerData.lastHeartbeat > this.heartbeatTimeout) {
          await this.redis.hdel(this.WORKER_REGISTRY_KEY, workerId);
          this.logger.log(`清理过期的 Worker 注册: ${workerId}`);
        }
      }
    } catch (error) {
      this.logger.error('清理过期 Worker 时发生错误:', error);
    }
  }

  /**
   * 检查当前节点是否为领导者
   */
  isCurrentNodeLeader(): boolean {
    return this.isLeader;
  }

  /**
   * 获取当前节点ID
   */
  getCurrentNodeId(): string {
    return this.nodeId;
  }

  /**
   * 获取 Redis 客户端实例
   */
  getRedisClient(): Redis {
    return this.redis;
  }

  /**
   * 从注册表中移除 Worker
   */
  async removeWorkerFromRegistry(workerId: string): Promise<void> {
    try {
      await this.redis.hdel(this.WORKER_REGISTRY_KEY, workerId);
      this.logger.debug(`Worker ${workerId} 已从注册表中移除`);
    } catch (error) {
      this.logger.error(`从注册表移除 Worker ${workerId} 时发生错误:`, error);
    }
  }

  /**
   * 获取当前领导者信息
   */
  async getCurrentLeader(): Promise<any> {
    try {
      const leaderInfo = await this.redis.get(this.LEADER_INFO_KEY);
      return leaderInfo ? JSON.parse(leaderInfo) : null;
    } catch (error) {
      this.logger.error('获取当前领导者信息时发生错误:', error);
      return null;
    }
  }
} 