import { describe, expect, it } from 'vitest'
import { parseCreateStaffInput } from './validate.ts'

const valid = { email: ' Ana@Example.COM ', password: 'secret123', fullName: '  Ana Pérez ', role: 'waiter' }

describe('parseCreateStaffInput', () => {
  it('normalizes email and full name', () => {
    expect(parseCreateStaffInput(valid)).toEqual({
      ok: true,
      value: { email: 'ana@example.com', password: 'secret123', fullName: 'Ana Pérez', role: 'waiter' },
    })
  })

  it.each(['waiter', 'kitchen', 'cashier', 'delivery_operator'])('accepts role %s', (role) => {
    expect(parseCreateStaffInput({ ...valid, role }).ok).toBe(true)
  })

  it.each([
    ['admin role', { role: 'admin' }],
    ['unknown role', { role: 'root' }],
    ['invalid email', { email: 'nope' }],
    ['short password', { password: '1234567' }],
    ['empty name', { fullName: '   ' }],
    ['long name', { fullName: 'x'.repeat(101) }],
    ['non-string password', { password: 12345678 }],
  ])('rejects %s', (_label, patch) => {
    expect(parseCreateStaffInput({ ...valid, ...patch }).ok).toBe(false)
  })

  it('rejects non-object bodies', () => {
    expect(parseCreateStaffInput(null).ok).toBe(false)
    expect(parseCreateStaffInput('x').ok).toBe(false)
  })
})
