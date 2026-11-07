import { Injectable } from '@nestjs/common';
import type { SQL } from '@vipe/db';
import type { SupervisorAction } from '../auth/pins';
import { SupervisorAuthorizationsService } from '../auth/supervisor-authorizations.service';
import { UnitOfWork } from '../db/unit-of-work';
import { toVoidException } from './voids';

type Json = Record<string, unknown>;

/**
 * Runs one cancellation or void: consumes the supervisor authorization (F2)
 * and calls the 0018 function, both in the request transaction, so a refused
 * write does not spend the authorization. The function's `<fn>: <code>`
 * refusals become the Spanish 403/404/409/422 of VOID_ERRORS.
 */
@Injectable()
export class VoidsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorizations: SupervisorAuthorizationsService,
  ) {}

  async run(action: SupervisorAction, authorizationId: string | undefined, call: SQL): Promise<Json> {
    if (authorizationId) {
      await this.authorizations.consume(authorizationId, action);
    }
    try {
      const { rows } = await this.uow.db.execute(call);
      return (rows[0] as { result: Json }).result;
    } catch (error) {
      throw toVoidException(error) ?? error;
    }
  }
}
