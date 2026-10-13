import { describe, expect, it, vi } from 'vitest'
// The default client needs env vars at import time; tests inject a fake instead.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { StaffServiceError, createStaffAccount, type StaffFunctionsClient } from './staff-service'

const input = { email: 'a@b.co', password: 'secret123', fullName: 'Ana', role: 'waiter' as const }

function client(result: { data?: unknown; error?: unknown }): StaffFunctionsClient {
  return { functions: { invoke: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) } }
}

function httpError(status: number, body: unknown = {}) {
  return { name: 'FunctionsHttpError', message: 'non-2xx', context: new Response(JSON.stringify(body), { status }) }
}

describe('createStaffAccount', () => {
  it('invokes the function and returns the profile', async () => {
    const profile = { id: 'p', fullName: 'Ana', email: 'a@b.co', role: 'waiter' }
    const c = client({ data: { profile } })
    expect(await createStaffAccount(input, c)).toEqual(profile)
    expect(c.functions.invoke).toHaveBeenCalledWith('create-staff-account', { body: input })
  })

  it.each([
    [400, 'invalid'],
    [403, 'forbidden'],
    [409, 'duplicate'],
    [500, 'unknown'],
  ])('maps HTTP %i to kind %s with a Spanish message', async (status, kind) => {
    const err = await createStaffAccount(input, client({ error: httpError(status) })).catch((e) => e)
    expect(err).toBeInstanceOf(StaffServiceError)
    expect(err.kind).toBe(kind)
    expect(err.message).toMatch(/[a-záéíóú]/i)
  })

  it('surfaces the server message for HTTP 400, falling back to the generic one', async () => {
    const withMsg = await createStaffAccount(
      input,
      client({ error: httpError(400, { error: 'La contraseña no cumple los requisitos de seguridad' }) }),
    ).catch((e) => e)
    expect(withMsg.kind).toBe('invalid')
    expect(withMsg.message).toBe('La contraseña no cumple los requisitos de seguridad')
    const without = await createStaffAccount(input, client({ error: httpError(400, 'not json object') })).catch((e) => e)
    expect(without.message).toBe('Los datos ingresados no son válidos')
  })

  it('maps network failures to unknown', async () => {
    const err = await createStaffAccount(input, client({ error: new Error('fetch failed') })).catch((e) => e)
    expect(err.kind).toBe('unknown')
  })
})
