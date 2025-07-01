import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerElectionService } from 'nestjs-affinity-queue';

@Injectable()
export class ElectionTestService implements OnModuleInit {
  private readonly logger = new Logger(ElectionTestService.name);

  constructor(private readonly electionService: SchedulerElectionService) {}

  async onModuleInit() {
    // 等待选举服务初始化
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.logger.log('=== 选举测试服务启动 ===');
    this.logger.log(`当前节点ID: ${this.electionService.getCurrentNodeId()}`);
    this.logger.log(`是否为领导者: ${this.electionService.isCurrentNodeLeader()}`);
    
    // 获取当前领导者信息
    const leader = await this.electionService.getCurrentLeader();
    if (leader) {
      this.logger.log(`当前领导者: ${leader.nodeId} (${leader.hostname}:${leader.processId})`);
    } else {
      this.logger.log('当前没有领导者');
    }
    
    // 获取注册的 Worker
    const workers = await this.electionService.getRegisteredWorkers();
    this.logger.log(`注册的 Worker 数量: ${workers.size}`);
    
    for (const [workerId, workerInfo] of workers.entries()) {
      this.logger.log(`  - ${workerId} (${workerInfo.hostname}:${workerInfo.processId})`);
    }
    
    // 定期输出状态信息
    setInterval(async () => {
      const isLeader = this.electionService.isCurrentNodeLeader();
      const leader = await this.electionService.getCurrentLeader();
      const workers = await this.electionService.getRegisteredWorkers();
      
      this.logger.log(`状态更新 - 领导者: ${isLeader}, 当前领导者: ${leader?.nodeId || '无'}, Worker数量: ${workers.size}`);
    }, 10000);
  }
} 