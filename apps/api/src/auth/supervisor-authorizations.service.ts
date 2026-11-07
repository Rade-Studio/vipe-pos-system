import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import { Clock } from '../common/clock';
import { UnitOfWork } from '../db/unit-of-work';
import { PIN_MESSAGES } from './pins';

/**
 * The guard F1 calls before a cancellation or void: consume, once, the
 * authorization id POST /auth/authorize returned for that action. It runs in
 * the request transaction, so when the guarded write fails the authorization
 * is not spent. Exported by AuthModule.
 */
@Injectable()
export class SupervisorAuthorizationsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * The supervisor who authorized `action`; 403 `authorization_invalid` when
   * the id is unknown, of another restaurant, for another action, expired
   * (2 minutes) or already used.
   */
  async consume(authorizationId: string, action: string): Promise<{ supervisorProfileId: string }> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT private.consume_supervisor_authorization(${authorizationId}::uuid, ${action}, ${this.clock.now().toISOString()}::timestamptz) AS supervisor`);
    const supervisor = rows[0]?.supervisor as string | null | undefined;
    if (!supervisor) {
      throw new ForbiddenException({ message: PIN_MESSAGES.authorization, code: 'authorization_invalid' });
    }
    return { supervisorProfileId: supervisor };
  }
}
