import { describe, expect, it } from 'vitest';
import { APP_ROLES, isAppRole, roleLabel, viewForRole } from './roles';

describe('APP_ROLES', () => {
  it('exposes the canonical set of app roles, including the new delivery operator', () => {
    expect([...APP_ROLES].sort()).toEqual(
      ['admin', 'cashier', 'delivery_operator', 'kitchen', 'waiter'].sort(),
    );
  });
});

describe('isAppRole', () => {
  it('returns true for every canonical role', () => {
    for (const role of APP_ROLES) {
      expect(isAppRole(role)).toBe(true);
    }
  });

  it('rejects unknown values and non-strings', () => {
    expect(isAppRole('delivery')).toBe(false);
    expect(isAppRole('manager')).toBe(false);
    expect(isAppRole('')).toBe(false);
    expect(isAppRole(null)).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
    expect(isAppRole(42)).toBe(false);
    expect(isAppRole({ role: 'waiter' })).toBe(false);
  });
});

describe('roleLabel', () => {
  it('returns the Spanish label for every canonical role', () => {
    expect(roleLabel('admin')).toBe('Administrador');
    expect(roleLabel('cashier')).toBe('Caja');
    expect(roleLabel('waiter')).toBe('Mesero');
    expect(roleLabel('kitchen')).toBe('Cocina');
    expect(roleLabel('delivery_operator')).toBe('Operador de domicilios');
  });

  it('returns null for unknown values so callers can fall back', () => {
    expect(roleLabel('manager')).toBeNull();
    expect(roleLabel('')).toBeNull();
    expect(roleLabel(undefined)).toBeNull();
  });
});

describe('viewForRole', () => {
  it('maps every canonical role to its view key', () => {
    expect(viewForRole('admin')).toBe('admin');
    expect(viewForRole('cashier')).toBe('cashier');
    expect(viewForRole('waiter')).toBe('waiter');
    expect(viewForRole('kitchen')).toBe('kitchen');
    expect(viewForRole('delivery_operator')).toBe('delivery');
  });

  it('returns null for unknown values so the router can render the fallback', () => {
    expect(viewForRole('manager')).toBeNull();
    expect(viewForRole('')).toBeNull();
    expect(viewForRole(undefined)).toBeNull();
  });
});
