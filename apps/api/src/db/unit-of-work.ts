import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import { bindDb, type Database } from '@vipe/db';
import { DbClient } from './db-client';

interface Scope {
  readonly db: Database;
  readonly userId: string;
  readonly afterCommit: (() => void)[];
}

/**
 * One database transaction per authenticated request.
 *
 * `run` checks out a connection, opens a transaction, sets `app.user_id`
 * transaction-locally (what RLS and the private.current_* helpers read), runs
 * the work with a Drizzle client bound to that connection, then commits, or
 * rolls back on any thrown error, and always releases the connection.
 * Services read `db` from inside that scope; nothing else holds a client.
 * `afterCommit` defers side effects (socket emits) until the commit succeeded.
 */
@Injectable()
export class UnitOfWork {
  private readonly storage = new AsyncLocalStorage<Scope>();

  private readonly logger = new Logger('UnitOfWork');

  constructor(private readonly client: DbClient) {}

  /** Drizzle client of the current request transaction. */
  get db(): Database {
    const scope = this.storage.getStore();
    if (!scope) {
      throw new Error('UnitOfWork.db used outside a request transaction');
    }
    return scope.db;
  }

  /** Run `effect` once the current transaction has committed; never on rollback. */
  afterCommit(effect: () => void): void {
    const scope = this.storage.getStore();
    if (!scope) {
      throw new Error('UnitOfWork.afterCommit used outside a request transaction');
    }
    scope.afterCommit.push(effect);
  }

  async run<T>(userId: string, work: (db: Database) => Promise<T>): Promise<T> {
    const connection = await this.client.pool.connect();
    let broken: Error | undefined;
    // A checked-out client emits 'error' when the server drops it mid-request;
    // mark it broken so release() destroys it instead of returning it to the pool.
    const onError = (error: Error) => {
      broken = error;
    };
    connection.on('error', onError);
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const db = bindDb(connection);
      const afterCommit: (() => void)[] = [];
      const result = await this.storage.run({ db, userId, afterCommit }, () => work(db));
      await connection.query('COMMIT');
      for (const effect of afterCommit) {
        try {
          effect();
        } catch (error) {
          this.logger.warn(`after-commit effect failed: ${(error as Error).message}`);
        }
      }
      return result;
    } catch (error) {
      await connection.query('ROLLBACK').catch((rollbackError: Error) => {
        // A connection that cannot roll back is discarded, not reused.
        broken ??= rollbackError;
      });
      throw error;
    } finally {
      connection.off('error', onError);
      connection.release(broken);
    }
  }
}
