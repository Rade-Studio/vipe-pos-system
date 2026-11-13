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

describe('terminalRoute — carta inbox (carta-digital T5b, L29)', () => {
  it('lets a shared terminal read the waiter carta inbox', () => {
    expect(terminalRoute('GET', '/api/carta-inbox')).toEqual({ acting: false });
  });

  it('makes confirm, reject and resolve acting writes, like the waiter send', () => {
    expect(terminalRoute('POST', '/api/carta-inbox/proposals/:id/confirm')).toEqual({ acting: true });
    expect(terminalRoute('POST', '/api/carta-inbox/proposals/:id/reject')).toEqual({ acting: true });
    expect(terminalRoute('POST', '/api/carta-inbox/requests/:id/resolve')).toEqual({ acting: true });
  });

  it('keeps the delivery console off terminals', () => {
    expect(terminalRoute('GET', '/api/carta-delivery')).toBeUndefined();
    expect(terminalRoute('POST', '/api/carta-delivery/:id/confirm')).toBeUndefined();
    expect(terminalRoute('POST', '/api/carta-delivery/:id/reject')).toBeUndefined();
  });
});
