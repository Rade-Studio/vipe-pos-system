import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { AUDIT_LIST_LIMIT, type AuditEvent, type auditQuerySchema } from './audit.dto';
import { toAuditEvent } from './audit.mappers';

/** The append-only public.audit_log of the caller's restaurant (RLS); written only by the 0018/0019 functions. */
@Injectable()
export class AuditService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(query: z.infer<typeof auditQuerySchema>): Promise<AuditEvent[]> {
    const where: SQL[] = [sql`true`];
    if (query.from) {
      where.push(sql`a.created_at >= (${query.from}::date::timestamp AT TIME ZONE r.timezone)`);
    }
    if (query.to) {
      where.push(sql`a.created_at < ((${query.to}::date + 1)::timestamp AT TIME ZONE r.timezone)`);
    }
    if (query.type) {
      where.push(sql`a.event_type = ANY(${sql.param(query.type)}::text[])`);
    }
    if (query.actorId) {
      where.push(sql`a.actor_profile_id = ${query.actorId}`);
    }
    if (query.authorizerId) {
      where.push(sql`a.authorized_by_profile_id = ${query.authorizerId}`);
    }
    if (query.selfAuthorized !== undefined) {
      where.push(sql`a.self_authorized = ${query.selfAuthorized}`);
    }
    const { rows } = await this.uow.db.execute(sql`
      SELECT to_jsonb(a) || jsonb_build_object('order_type', o.order_type) AS event
        FROM public.audit_log a
        JOIN public.restaurants r ON r.id = a.restaurant_id
        JOIN public.orders o ON o.id = a.order_id
       WHERE ${sql.join(where, sql` AND `)}
       ORDER BY a.created_at DESC, a.id
       LIMIT ${AUDIT_LIST_LIMIT}`);
    return (rows as { event: Record<string, unknown> }[]).map((row) => toAuditEvent(row.event));
  }
}
