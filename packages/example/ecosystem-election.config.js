module.exports = {
  apps: [
    {
      name: 'affinity-queue-election',
      script: 'dist/main.js',
      instances: -1, // 使用所有可用核心，所有实例都参与选举
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'BOTH', // 所有实例都是 BOTH 模式，通过选举决定角色
        REDIS_URL: 'redis://localhost:6379',
        DEFAULT_MAX_BATCH_SIZE: '10',
        SCHEDULER_INTERVAL: '1000',
        WORKER_COUNT: '2',
        MAX_BATCH_SIZE: '5',
        // 选举配置
        ELECTION_LOCK_TTL: '30000', // 30秒
        HEARTBEAT_INTERVAL: '10000', // 10秒
        HEARTBEAT_TIMEOUT: '60000', // 60秒
      },
      env_production: {
        NODE_ENV: 'production',
        APP_ROLE: 'BOTH',
        REDIS_URL: 'redis://localhost:6379',
        DEFAULT_MAX_BATCH_SIZE: '10',
        SCHEDULER_INTERVAL: '1000',
        WORKER_COUNT: '2',
        MAX_BATCH_SIZE: '5',
        ELECTION_LOCK_TTL: '30000',
        HEARTBEAT_INTERVAL: '10000',
        HEARTBEAT_TIMEOUT: '60000',
      },
    },
  ],
}; 