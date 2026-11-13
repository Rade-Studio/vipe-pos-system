import { ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CARTA_DELIVERY_MESSAGES as D } from './carta-delivery.dto';
import { CARTA_MESSAGES } from './carta.dto';
import { CARTA_TABLE_MESSAGES as M } from './carta-table.dto';
import { RATE_LIMIT_MESSAGE } from './rate-limit';

const tooMany = (message: string) => () => new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);

/** The `<function>: <code>` errors of 0036 and 0037, as HTTP with the artboard copy; the DB message never leaves the API. */
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
  delivery_ordering_disabled: () => new ConflictException(D.orderingDisabled),
  too_busy: tooMany(D.tooBusy),
  customer_invalid: () => new UnprocessableEntityException(D.customerInvalid),
  name_invalid: () => new UnprocessableEntityException(D.nameInvalid),
  phone_invalid: () => new UnprocessableEntityException(D.phoneInvalid),
  address_invalid: () => new UnprocessableEntityException(D.addressInvalid),
  neighborhood_invalid: () => new UnprocessableEntityException(D.neighborhoodInvalid),
  payment_invalid: () => new UnprocessableEntityException(D.paymentInvalid),
  delivery_request_not_found: () => new NotFoundException(D.requestNotFound),
  delivery_request_not_pending: () => new ConflictException(M.proposalNotPending),
  delivery_request_not_confirmed: () => new ConflictException(D.requestNotConfirmed),
  delivery_request_already_linked: () => new ConflictException(D.requestAlreadyLinked),
  delivery_order_not_found: () => new NotFoundException(D.deliveryOrderNotFound),
  delivery_order_already_linked: () => new ConflictException(D.deliveryOrderAlreadyLinked),
};

/** A code whose copy depends on the function (`<function>: <code>`), looked up before CODES. */
const FUNCTION_CODES: Record<string, () => HttpException> = {
  'guest_submit_delivery: too_many_pending': tooMany(D.tooManyPending),
};

/** A carta function error whose code has no mapping yet: a generic answer, never the DB text. */
const UNMAPPED_MESSAGE = 'No pudimos procesar la solicitud.';

/** The function and code of a raised 0036/0037 error (pg directly, or Drizzle's `cause` chain). */
function raisedCode(error: unknown): { fn: string; code: string } | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    const { code } = current as { code?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      const match = /^([a-z_]+): ([a-z_]+)$/.exec(current.message);
      return match ? { fn: match[1], code: match[2] } : undefined;
    }
    current = current.cause;
  }
  return undefined;
}

/** Rethrow a 0036/0037 function error as its HTTP answer (unmapped codes get a generic 422); anything else unchanged. */
export function cartaDbError(error: unknown): never {
  const raised = raisedCode(error);
  if (raised === undefined) {
    throw error;
  }
  const make = FUNCTION_CODES[`${raised.fn}: ${raised.code}`] ?? CODES[raised.code];
  throw make ? make() : new UnprocessableEntityException(UNMAPPED_MESSAGE);
}
