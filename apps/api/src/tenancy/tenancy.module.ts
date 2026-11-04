import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UnitOfWorkInterceptor } from './unit-of-work.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: UnitOfWorkInterceptor }],
})
export class TenancyModule {}
