import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Redis 连接管理器
 * 负责管理共享的 Redis 连接，确保在应用关闭时最后清理
 */
@Injectable()
export class RedisConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(RedisConnectionManager.name);
  private readonly connections = new Map<string, Redis>();

  /**
   * 获取或创建 Redis 连接
   */
  getConnection(name: string, redisOptions: any): Redis {
    if (this.connections.has(name)) {
      return this.connections.get(name)!;
    }

    const connection: any = {
      host: redisOptions.host || 'localhost',
      port: redisOptions.port || 6379,
    };

    if (redisOptions.password) {
      connection.password = redisOptions.password;
    }

    if (redisOptions.db !== undefined && redisOptions.db !== 0) {
      connection.db = redisOptions.db;
    }

    connection.maxRetriesPerRequest = null;

    const redis = new Redis(connection);
    this.connections.set(name, redis);
    
    this.logger.log(`Created Redis connection: ${name}`);
    return redis;
  }

  /**
   * 优雅关闭所有连接
   */
  async onModuleDestroy() {
    this.logger.log('Closing all Redis connections...');
    
    const closePromises = Array.from(this.connections.entries()).map(async ([name, redis]) => {
      try {
        if (redis.status === 'ready') {
          await redis.quit();
          this.logger.log(`Redis connection closed: ${name}`);
        } else {
          this.logger.log(`Redis connection ${name} already closed (status: ${redis.status})`);
        }
      } catch (error) {
        // 忽略连接已关闭的错误
        if (error.message && !error.message.includes('Connection is closed')) {
          this.logger.error(`Error closing Redis connection ${name}:`, error);
        }
      }
    });

    await Promise.all(closePromises);
    this.connections.clear();
    this.logger.log('All Redis connections closed');
  }
}