/**
 * 工作节点状态对象
 * 该状态对象必须存储在调度节点和工作节点均可访问的共享位置（如 Redis Hash）
 */
export interface WorkerState {
  /**
   * Worker 的唯一ID，与进程实例相关。
   */
  workerId: string;

  /**
   * Worker 当前状态。
   * 'idle': 空闲，可以接受任何 identifyTag 的新任务。
   * 'running': 运行中，正在处理一个特定 identifyTag 的任务。
   */
  status: 'idle' | 'running';

  /**
   * 当前正在处理的 identifyTag。若为空闲状态，则为 null。
   */
  currentIdentifyTag: string | null;

  /**
   * 当前批次已接收/处理的任务数量。
   */
  currentBatchSize: number;
} 