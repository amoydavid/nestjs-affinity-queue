import { Redis } from 'ioredis';

/**
 * Redis 工具类
 * 提供安全的 Redis 操作方法
 */
export class RedisUtils {
  /**
   * 使用 SCAN 命令安全地获取匹配模式的键
   * 避免在生产环境中使用 KEYS 命令导致的阻塞问题
   * 
   * @param redis Redis 实例
   * @param pattern 键模式
   * @param count 每次扫描的键数量，默认 100
   * @returns 匹配的键数组
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

  /**
   * 使用 SCAN 命令安全地获取匹配模式的哈希键
   * 
   * @param redis Redis 实例
   * @param key 哈希键名
   * @param pattern 字段模式
   * @param count 每次扫描的字段数量，默认 100
   * @returns 匹配的字段数组
   */
  static async scanHashFields(redis: Redis, key: string, pattern: string, count: number = 100): Promise<string[]> {
    const fields: string[] = [];
    let cursor = '0';
    
    do {
      const result = await redis.hscan(key, cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = result[0];
      fields.push(...result[1]);
    } while (cursor !== '0');
    
    return fields;
  }

  /**
   * 使用 SCAN 命令安全地获取匹配模式的集合成员
   * 
   * @param redis Redis 实例
   * @param key 集合键名
   * @param pattern 成员模式
   * @param count 每次扫描的成员数量，默认 100
   * @returns 匹配的成员数组
   */
  static async scanSetMembers(redis: Redis, key: string, pattern: string, count: number = 100): Promise<string[]> {
    const members: string[] = [];
    let cursor = '0';
    
    do {
      const result = await redis.sscan(key, cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = result[0];
      members.push(...result[1]);
    } while (cursor !== '0');
    
    return members;
  }
} 