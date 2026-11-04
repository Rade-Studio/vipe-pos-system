import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text (extension `citext`); drizzle-kit pull cannot map it. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
