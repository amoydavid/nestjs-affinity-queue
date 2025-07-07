/**
 * =======================================================================
 * Public API
 * =======================================================================
 * This file is the entry point for the nestjs-affinity-queue library.
 * It exports all the necessary modules, services, interfaces, and functions
 * for users to integrate and use the queueing system.
 * =======================================================================
 */

// ==============================================
//      PRIMARY MODULE AND CONFIGURATION
// ==============================================

export { QueueModule } from './queue.module';
export type { QueueModuleOptions, QueueModuleAsyncOptions } from './queue.module';

// ==============================================
//      INJECTION TOKENS FOR FOR_FEATURE
// ==============================================

export {
  getQueueServiceToken,
  getWorkerServiceToken,
  getSchedulerProcessorToken,
  getQueueOptionsToken,
} from './queue.module';


// ==============================================
//      CORE SERVICES
// ==============================================

export { QueueService } from './queue.service';
export { WorkerService } from './worker/worker.service';
export { SchedulerElectionService } from './scheduler/scheduler.election';


// ==============================================
//      INTERFACES & DTOS
// ==============================================

export { Task } from './common/interfaces/task.interface';
export { WorkerState } from './common/interfaces/worker-state.interface';
export { TaskDto } from './common/dtos/task.dto';


// ==============================================
//      UTILITIES
// ==============================================

export { RedisUtils } from './common/utils/redis.utils';