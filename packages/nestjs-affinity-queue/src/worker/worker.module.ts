import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { queueConfig } from '../config/config';
import { WorkerManager } from './worker.manager';
import { WorkerProcessor } from './worker.processor';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
  ],
  providers: [
    WorkerManager,
    WorkerProcessor,
  ],
  exports: [
    WorkerManager,
    WorkerProcessor,
  ],
})
export class WorkerModule {} 