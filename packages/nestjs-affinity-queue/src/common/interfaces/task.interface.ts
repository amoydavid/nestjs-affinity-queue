/**
 * 任务对象接口
 */
export interface Task {
  /**
   * 任务类型，用于Worker映射到具体的处理逻辑。
   * e.g., 'generate-invoice', 'send-welcome-email'
   */
  type: string;

  /**
   * 任务的身份标识，调度的核心依据。
   * e.g., 'company-abc', 'user-123'
   */
  identifyTag: string;

  /**
   * 执行任务所需的具体数据。
   */
  payload: any;
} 