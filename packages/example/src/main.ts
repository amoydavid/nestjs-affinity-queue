import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule);
  
  // 获取应用角色
  const role = process.env.APP_ROLE || 'BOTH';
  logger.log(`应用启动，角色: ${role}`);
  
  await app.listen(3000);
  logger.log('应用已启动，监听端口 3000');
}

bootstrap(); 