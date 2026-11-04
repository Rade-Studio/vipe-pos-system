import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [EnvModule, HealthModule],
})
export class AppModule {}
