import { of, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { JsonNullInterceptor } from './json-null.interceptor';

const run = (value: unknown) =>
  lastValueFrom(new JsonNullInterceptor().intercept({} as never, { handle: () => of(value) }));

describe('JsonNullInterceptor', () => {
  it('turns null into a body that serializes as the JSON literal null', async () => {
    const body = await run(null);
    expect(body).not.toBeNull();
    expect(JSON.stringify(body)).toBe('null');
  });

  it('passes other values through', async () => {
    const value = { id: 'r1' };
    expect(await run(value)).toBe(value);
  });
});
