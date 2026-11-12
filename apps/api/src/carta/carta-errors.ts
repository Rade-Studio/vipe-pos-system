import { ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CARTA_MESSAGES } from './carta.dto';
import { CARTA_TABLE_MESSAGES as M } from './carta-table.dto';
import { RATE_LIMIT_MESSAGE } from './rate-limit';

const tooMany = (message: string) => () => new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);

/** The `<function>: <code>` errors of 0036, as HTTP with the artboard copy; the DB message never leaves the API. */
const CODES: Record<string, () => HttpException> = {
  carta_not_found: () => new NotFoundException(CARTA_MESSAGES.notFound),
  table_not_found: () => new NotFoundException(CARTA_MESSAGES.notFound),
  table_ordering_disabled: () => new ConflictException(M.orderingDisabled),
  table_not_open: () => new ConflictException(M.tableNotOpen),
  dish_unavailable: () => new ConflictException(M.dishUnavailable),
  options_invalid: () => new UnprocessableEntityException(M.optionsInvalid),
  items_invalid: () => new UnprocessableEntityException(M.itemsInvalid),
  note_invalid: () => new UnprocessableEntityException(M.noteInvalid),
  guest_key_invalid: () => new UnprocessableEntityException(M.guestKeyInvalid),
  kind_invalid: () => new UnprocessableEntityException(M.kindInvalid),
  rating_invalid: () => new UnprocessableEntityException(M.ratingInvalid),
  comment_invalid: () => new UnprocessableEntityException(M.commentInvalid),
  reason_invalid: () => new UnprocessableEntityException(M.reasonInvalid),
  too_many_pending: tooMany(M.tooManyPending),
  too_many_feedback: tooMany(RATE_LIMIT_MESSAGE),
  role_not_allowed: () => new ForbiddenException(M.roleNotAllowed),
  proposal_not_found: () => new NotFoundException(M.proposalNotFound),
  request_not_found: () => new NotFoundException(M.requestNotFound),
  proposal_not_pending: () => new ConflictException(M.proposalNotPending),
  order_not_open: () => new ConflictException(M.orderNotOpen),
  proposal_not_confirmed: () => new ConflictException(M.proposalNotConfirmed),
  proposal_already_linked: () => new ConflictException(M.proposalAlreadyLinked),
  item_not_in_order: () => new ConflictException(M.itemNotInOrder),
};

/** A carta function error whose code has no mapping yet: a generic answer, never the DB text. */
const UNMAPPED_MESSAGE = 'No pudimos procesar la solicitud.';

/** The 0036 code of a raised error (pg directly, or Drizzle's `cause` chain). */
function raisedCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    const { code } = current as { code?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return /^[a-z_]+: ([a-z_]+)$/.exec(current.message)?.[1];
    }
    current = current.cause;
  }
  return undefined;
}

/** Rethrow a 0036 function error as its HTTP answer (unmapped codes get a generic 422); anything else unchanged. */
export function cartaDbError(error: unknown): never {
  const code = raisedCode(error);
  if (code === undefined) {
    throw error;
  }
  const make = CODES[code];
  throw make ? make() : new UnprocessableEntityException(UNMAPPED_MESSAGE);
}
