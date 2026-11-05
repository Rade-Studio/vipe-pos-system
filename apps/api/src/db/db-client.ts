import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { createDb, type Pool } from '@vipe/db';

/**
 * The API's single connection pool, connected as vipe_api (never a superuser,
 * never BYPASSRLS). Request handlers do not use it directly: they go through
 * UnitOfWork. Public routes (login, refresh, logout) call the SECURITY DEFINER
 * auth helpers on it, outside any app.user_id. Built by DbModule from ENV.
 */
export class DbClient implements OnModuleDestroy {
  readonly pool: Pool;

  private readonly logger = new Logger('DbClient');

  constructor(databaseUrl: string) {
    // Per-connection timeouts: a stuck query or a request that leaves its
    // transaction open cannot hold a connection forever. They live here, not
    // on the role, because vipe_migrator cannot ALTER ROLE vipe_api.
    this.pool = createDb(databaseUrl, {
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 15_000,
    }).pool;
    // An idle client killed by the server (restart, pg_terminate_backend) is
    // dropped by the pool; without this listener the error crashes the process.
    this.pool.on('error', (error) => {
      this.logger.warn(`idle database connection lost: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
