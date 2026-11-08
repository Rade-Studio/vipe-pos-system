import { describe, expect, it } from 'vitest';
import { terminalRoute } from './terminal-access';

describe('terminalRoute', () => {
  it('lets the identified waiter reserve a table from a shared terminal (reservas-mesas S3)', () => {
    expect(terminalRoute('POST', '/api/tables/:id/reserve')).toEqual({ acting: true });
  });

  it('keeps assign and release as acting writes and refuses routes it does not list', () => {
    expect(terminalRoute('post', '/api/tables/:id/assign')).toEqual({ acting: true });
    expect(terminalRoute('POST', '/api/tables/:id/release')).toEqual({ acting: true });
    expect(terminalRoute('PATCH', '/api/tables/:id')).toBeUndefined();
    expect(terminalRoute('POST', undefined)).toBeUndefined();
  });
});
