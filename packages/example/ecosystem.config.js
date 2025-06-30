module.exports = {
  apps: [
    {
      name: 'affinity-queue-scheduler',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'SCHEDULER',
        REDIS_URL: 'redis://localhost:6379',
        DEFAULT_MAX_BATCH_SIZE: '10',
        SCHEDULER_INTERVAL: '1000',
      },
      env_production: {
        NODE_ENV: 'production',
        APP_ROLE: 'SCHEDULER',
        REDIS_URL: 'redis://localhost:6379',
        DEFAULT_MAX_BATCH_SIZE: '10',
        SCHEDULER_INTERVAL: '1000',
      },
    },
    {
      name: 'affinity-queue-workers',
      script: 'dist/main.js',
      instances: -1, // 使用所有可用核心
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'WORKER',
        REDIS_URL: 'redis://localhost:6379',
        MAX_BATCH_SIZE: '5',
      },
      env_production: {
        NODE_ENV: 'production',
        APP_ROLE: 'WORKER',
        REDIS_URL: 'redis://localhost:6379',
        MAX_BATCH_SIZE: '5',
      },
    },
  ],
}; 