// 主模块
export { QueueModule } from './queue.module';
export type { QueueModuleOptions } from './queue.module';

// 服务
export { QueueService } from './queue.service';
export { WorkerService } from './worker/worker.service';
export { WorkerManager } from './worker/worker.manager';

// 接口和类型
export { Task } from './common/interfaces/task.interface';
export { WorkerState } from './common/interfaces/worker-state.interface';
export { TaskDto } from './common/dtos/task.dto';

// 配置
export * from './config/config';

// 子模块（供高级用户使用）
export { SchedulerModule } from './scheduler/scheduler.module';
export { WorkerModule } from './worker/worker.module';
export { SchedulerProcessor } from './scheduler/scheduler.processor';

// 通用接口和 DTO
export * from './common/interfaces/task.interface';
export * from './common/interfaces/worker-state.interface';
export * from './common/dtos/task.dto';

// 核心服务
export * from './queue.service';
export * from './queue.module';

// 调度器
export * from './scheduler/scheduler.processor';
export * from './scheduler/scheduler.module';

// Worker
export * from './worker/worker.module';
export * from './worker/worker.service';

// 工具类
export * from './common/utils/redis.utils'; 