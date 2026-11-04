import { Injectable } from '@nestjs/common';
import { schema, sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { type BusinessConfig, CONFIG_KEYS, type ConfigField, configFromRows, type updateConfigSchema } from './business-config';

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
    const values = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ key: CONFIG_KEYS[field as ConfigField].key, value: String(value) }));
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
}
