import { describe, expect, it } from 'vitest';
import { parseNotice } from './change-event';

const notice = (table: string) => JSON.stringify({ table, op: 'INSERT', id: 'x', restaurant_id: 'r' });

describe('parseNotice whitelist (private.realtime_row)', () => {
  it.each(['orders', 'order_items', 'tables', 'zones', 'order_deliveries', 'carta_table_proposals', 'carta_table_requests', 'carta_delivery_requests'])(
    'accepts %s',
    (table) => {
      expect(parseNotice(notice(table))).toEqual({ table, op: 'INSERT', id: 'x', restaurant_id: 'r' });
    },
  );

  it.each(['carta_feedback', 'profiles', ''])('ignores %s', (table) => {
    expect(parseNotice(notice(table))).toBeUndefined();
  });
});
