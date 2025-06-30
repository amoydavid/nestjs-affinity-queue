import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

/**
 * 任务数据传输对象
 */
export class TaskDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  identifyTag: string;

  @IsObject()
  @IsOptional()
  payload: any;
} 