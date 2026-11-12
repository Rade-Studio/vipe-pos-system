import { describe, expect, it } from 'vitest';
import { toAuditEvent } from './audit.mappers';

const row = (order_type: unknown) => ({
  id: 'a1',
  event_type: 'order_cancelled',
  order_id: 'o1',
  order_type,
  actor_profile_id: 'p1',
  actor_name: 'Ana',
  reason_code: 'customer_left',
  amount: 0,
  details: {},
  created_at: '2026-11-12T10:00:00Z',
});

describe('toAuditEvent orderType', () => {
  it('keeps takeaway as its own type (S8)', () => {
    expect(toAuditEvent(row('takeaway')).orderType).toBe('takeaway');
  });

  it('keeps delivery and maps dine_in or unknown to dine_in', () => {
    expect(toAuditEvent(row('delivery')).orderType).toBe('delivery');
    expect(toAuditEvent(row('dine_in')).orderType).toBe('dine_in');
    expect(toAuditEvent(row(null)).orderType).toBe('dine_in');
  });
});
