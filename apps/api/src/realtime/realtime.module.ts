import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { DbClient } from '../db/db-client';
import { PgListenerService } from './pg-listener.service';
import { RealtimeGateway } from './realtime.gateway';

/** pg_notify -> PgListenerService -> RealtimeGateway rooms (T6). */
@Module({
  imports: [AuthModule],
  providers: [
    RealtimeGateway,
    {
      provide: PgListenerService,
      useFactory: (env: Env, db: DbClient, gateway: RealtimeGateway) =>
        new PgListenerService(env.databaseUrl, db, gateway),
      inject: [ENV, DbClient, RealtimeGateway],
    },
  ],
})
export class RealtimeModule {}
