/**
 * What a terminal session (a shared order-taking device, F2) may call. Any
 * route not listed answers 403 `terminal_route`, so a terminal opened by an
 * admin never reaches the admin screens. Routes marked `acting` are the order
 * writes: there the `X-Vipe-Acting` claim from POST /auth/identify makes the
 * request run as the identified staff member, and without it they are refused
 * while waiter_access_mode = shared_terminal. On every other route the claim
 * is ignored, so PIN attempts always count on the terminal itself.
 *
 * Keys are `METHOD /path` with the Express route pattern (global prefix included).
 */
export const ACTING_HEADER = 'x-vipe-acting';

interface TerminalRoute {
  readonly acting: boolean;
}

const read: TerminalRoute = { acting: false };
const write: TerminalRoute = { acting: true };

const TERMINAL_ROUTES: Readonly<Record<string, TerminalRoute>> = {
  'GET /api/auth/me': read,
  'POST /api/auth/identify': read,
  // F4b: a supervisor PIN lifts the lock of the terminal that guessed.
  'POST /api/auth/terminal/unlock': read,
  'GET /api/staff/supervisors': read,
  'GET /api/config': read,
  'GET /api/staff/waiters': read,
  'GET /api/tables': read,
  'GET /api/zones': read,
  'GET /api/catalog/categories': read,
  'GET /api/catalog/subcategories': read,
  'GET /api/catalog/dishes': read,
  'GET /api/catalog/promotions': read,
  'GET /api/catalog/promotions/active': read,
  'GET /api/catalog/promotions/today': read,
  'GET /api/catalog/promotions/:id/dishes': read,
  'GET /api/catalog/menu/tree': read,
  'GET /api/orders': read,
  'GET /api/orders/:id': read,
  'GET /api/payments/methods': read,
  'POST /api/inventory/check-stock': read,
  'POST /api/inventory/dish-availability': read,
  // promociones S8: the waiter's draft priced as if sent now; no writes.
  'POST /api/orders/pricing-preview': read,
  'POST /api/orders': write,
  'POST /api/orders/:id/items': write,
  'PATCH /api/orders/:id': write,
  'PATCH /api/orders/:id/status': write,
  'POST /api/tables/:id/assign': write,
  'POST /api/tables/:id/release': write,
  // reservas-mesas: the identified waiter reserves a free table (reserved_by is them).
  'POST /api/tables/:id/reserve': write,
  'POST /api/print/commands': write,
  // F1: the identified staff member asks for the supervisor authorization and
  // cancels or voids with it (it is bound to the requester). Payment voids are
  // not terminal routes (cashier and admin only).
  'POST /api/auth/authorize': write,
  'POST /api/orders/:id/cancel': write,
  'POST /api/orders/:id/items/void': write,
  'DELETE /api/orders/:id': write,
  // carta-digital T5b (L29): the waiter carta inbox; the identified waiter
  // confirms, rejects and resolves (decided_by / resolved_by are them). The
  // delivery console (/api/carta-delivery) is not a terminal route.
  'GET /api/carta-inbox': read,
  'POST /api/carta-inbox/proposals/:id/confirm': write,
  'POST /api/carta-inbox/proposals/:id/reject': write,
  'POST /api/carta-inbox/requests/:id/resolve': write,
};

/** The terminal rule of a route, or undefined when a terminal may not call it. */
export function terminalRoute(method: string, routePath: string | undefined): TerminalRoute | undefined {
  return routePath ? TERMINAL_ROUTES[`${method.toUpperCase()} ${routePath}`] : undefined;
}
