import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { DbClient } from './db-client';
import { UnitOfWork } from './unit-of-work';

/** Global database access: the vipe_api pool (closed on shutdown) and the request unit of work. */
@Global()
@Module({
  providers: [
    { provide: DbClient, useFactory: (env: Env) => new DbClient(env.databaseUrl), inject: [ENV] },
    UnitOfWork,
  ],
  exports: [DbClient, UnitOfWork],
})
export class DbModule {}
