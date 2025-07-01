import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { queueConfig } from '../config/config';
import { WorkerManager } from './worker.manager';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
  ],
  providers: [
    WorkerManager,
  ],
  exports: [
    WorkerManager,
  ],
})
export class WorkerModule {} 