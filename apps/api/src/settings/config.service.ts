import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type BusinessConfig,
  CONFIG_KEYS,
  type ConfigField,
  configFromRows,
  INVOICE_RANGE_MESSAGE,
  INVOICE_VALIDITY_MESSAGE,
  storedValue,
  type updateConfigSchema,
} from './business-config';

const businessConfig = schema.businessConfig;

/** business_config of the caller's restaurant; RLS scopes reads to it and writes to its admin. */
@Injectable()
export class ConfigService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every known key, defaults filled; never inserts the defaults. */
  async get(): Promise<BusinessConfig> {
    const rows = await this.uow.db.select({ key: businessConfig.key, value: businessConfig.value }).from(businessConfig);
    return configFromRows(rows);
  }

  /** One upsert on (restaurant_id, key) in the request transaction, then the full config. */
  async update(input: z.infer<typeof updateConfigSchema>): Promise<BusinessConfig> {
    await this.checkInvoiceBounds(input);
    const values = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ key: CONFIG_KEYS[field as ConfigField].key, value: storedValue(value) }));
    if (values.length > 0) {
      await this.uow.db
        .insert(businessConfig)
        .values(values)
        .onConflictDoUpdate({
          target: [businessConfig.restaurantId, businessConfig.key],
          set: { value: sql`excluded.value`, updatedAt: sql`now()` },
        });
    }
    return this.get();
  }

  /**
   * H-014 / S2: the authorized range and the validity, as they will be after
   * this update (a key not sent keeps its stored value), must not end before
   * they start; 422 with the Spanish message, nothing stored.
   */
  private async checkInvoiceBounds(input: z.infer<typeof updateConfigSchema>): Promise<void> {
    const touched = ['invoiceRangeFrom', 'invoiceRangeTo', 'invoiceValidFrom', 'invoiceValidTo'] as const;
    if (!touched.some((field) => input[field] !== undefined)) {
      return;
    }
    const current = await this.get();
    const pick = <K extends (typeof touched)[number]>(field: K) => (input[field] === undefined ? current[field] : input[field]);
    const from = pick('invoiceRangeFrom');
    const to = pick('invoiceRangeTo');
    if (from != null && to != null && to < from) {
      throw new UnprocessableEntityException(INVOICE_RANGE_MESSAGE);
    }
    const validFrom = pick('invoiceValidFrom');
    const validTo = pick('invoiceValidTo');
    if (validFrom != null && validTo != null && validTo < validFrom) {
      throw new UnprocessableEntityException(INVOICE_VALIDITY_MESSAGE);
    }
  }
}
