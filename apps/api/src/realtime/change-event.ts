/** Tables whose changes reach the browser (private.realtime_row's whitelist). */
export type RealtimeTable = 'orders' | 'tables' | 'order_deliveries';

export type ChangeOp = 'INSERT' | 'UPDATE' | 'DELETE';

/** Parsed `pos_changes` NOTIFY payload, built by private.change_payload. */
export interface ChangeNotice {
  table: RealtimeTable;
  op: ChangeOp;
  /** Primary key (order_id for order_deliveries). */
  id: string;
  restaurant_id: string;
  /** Previous row (UPDATE/DELETE); only its key columns when old_truncated. */
  old?: Record<string, unknown>;
  old_truncated?: boolean;
}

/**
 * The `pos_changes` socket event: the shape of Supabase's
 * RealtimePostgresChangesPayload, so lib/realtime/order-merge.ts and
 * table-merge.ts consume it unchanged.
 */
export interface ChangeEvent {
  schema: 'public';
  table: RealtimeTable;
  /** When the API received the notification (Postgres sends no commit time). */
  commit_timestamp: string;
  eventType: ChangeOp;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  errors: null;
}

const TABLES: readonly string[] = ['orders', 'tables', 'order_deliveries'];
const OPS: readonly string[] = ['INSERT', 'UPDATE', 'DELETE'];

/** Parse a NOTIFY payload; undefined when it is not one of ours. */
export function parseNotice(payload: string | undefined): ChangeNotice | undefined {
  try {
    const notice = JSON.parse(payload ?? '') as Partial<ChangeNotice>;
    if (
      TABLES.includes(notice.table ?? '') &&
      OPS.includes(notice.op ?? '') &&
      typeof notice.id === 'string' &&
      typeof notice.restaurant_id === 'string'
    ) {
      return notice as ChangeNotice;
    }
  } catch {
    // Not JSON: ignored like any foreign payload.
  }
  return undefined;
}

/** `newRow` is the row loaded by private.realtime_row; DELETE has none. */
export function toChangeEvent(notice: ChangeNotice, newRow: Record<string, unknown> | undefined, at: Date): ChangeEvent {
  return {
    schema: 'public',
    table: notice.table,
    commit_timestamp: at.toISOString(),
    eventType: notice.op,
    new: newRow ?? {},
    old: notice.old ?? {},
    errors: null,
  };
}
