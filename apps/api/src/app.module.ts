import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { EnvModule } from './config/env.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [EnvModule, DbModule, AuthModule, TenancyModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
