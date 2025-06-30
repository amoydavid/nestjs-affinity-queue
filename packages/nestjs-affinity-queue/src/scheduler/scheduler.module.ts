import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { SchedulerProcessor } from './scheduler.processor';
import { queueConfig } from '../config/config';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    BullModule.registerQueue({
      name: 'pending-tasks',
    }),
  ],
  providers: [SchedulerProcessor],
  exports: [SchedulerProcessor],
})
export class SchedulerModule {} 