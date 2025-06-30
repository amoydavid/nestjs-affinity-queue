import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'NestJS Affinity Queue 示例应用运行中！';
  }
} 