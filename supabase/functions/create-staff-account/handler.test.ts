import { describe, expect, it, vi } from 'vitest'
import { createHandler, mapCreateUserError, type HandlerDeps } from './handler.ts'

const body = { email: 'new@x.com', password: 'secret123', fullName: 'Nuevo', role: 'cashier' }

function makeDeps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getCaller: vi.fn(async () => ({ authUserId: 'admin-auth' })),
    getCallerProfile: vi.fn(async () => ({ role: 'admin', active: true, restaurantId: 'rest-1' })),
    createUser: vi.fn(async () => ({ ok: true as const, userId: 'new-auth' })),
    applyProfile: vi.fn(async () => true),
    deleteUser: vi.fn(async () => undefined),
    activateUser: vi.fn(async () => true),
    readProfile: vi.fn(async () => ({ id: 'p1', full_name: 'Nuevo', email: 'new@x.com', role: 'cashier' })),
    ...over,
  }
}

function req(init: { method?: string; auth?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.auth !== null) headers.authorization = init.auth ?? 'Bearer jwt'
  return new Request('http://localhost/create-staff-account', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' || init.method === 'OPTIONS' ? undefined : JSON.stringify(init.body ?? body),
  })
}

describe('create-staff-account handler', () => {
  it('answers OPTIONS preflight with CORS headers', async () => {
    const res = await createHandler(makeDeps())(req({ method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('rejects non-POST with 405', async () => {
    expect((await createHandler(makeDeps())(req({ method: 'GET' }))).status).toBe(405)
  })

  it('returns 401 without bearer token or with invalid token', async () => {
    expect((await createHandler(makeDeps())(req({ auth: null }))).status).toBe(401)
    const deps = makeDeps({ getCaller: vi.fn(async () => null) })
    expect((await createHandler(deps)(req())).status).toBe(401)
  })

  it('returns 403 for non-admin or inactive callers and never creates a user', async () => {
    for (const profile of [
      { role: 'waiter', active: true, restaurantId: 'r' },
      { role: 'admin', active: false, restaurantId: 'r' },
      null,
    ]) {
      const deps = makeDeps({ getCallerProfile: vi.fn(async () => profile) })
      expect((await createHandler(deps)(req())).status).toBe(403)
      expect(deps.createUser).not.toHaveBeenCalled()
    }
  })

  it('returns 400 for admin role and invalid JSON', async () => {
    const deps = makeDeps()
    const res = await createHandler(deps)(req({ body: { ...body, role: 'admin' } }))
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    const bad = new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer j' }, body: '{' })
    expect((await createHandler(deps)(bad)).status).toBe(400)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('creates the user with restaurant from the caller profile, ignoring the body', async () => {
    const deps = makeDeps()
    const res = await createHandler(deps)(req({ body: { ...body, restaurant_id: 'evil', restaurantId: 'evil' } }))
    expect(res.status).toBe(201)
    expect(deps.createUser).toHaveBeenCalledWith({
      email: 'new@x.com',
      password: 'secret123',
      email_confirm: true,
      ban_duration: '876000h',
      app_metadata: { role: 'cashier', restaurant_id: 'rest-1' },
      user_metadata: { full_name: 'Nuevo' },
    })
    expect(await res.json()).toEqual({
      profile: { id: 'p1', fullName: 'Nuevo', email: 'new@x.com', role: 'cashier' },
    })
  })

  it('applies role and tenant to the profile explicitly (GoTrue sets app_metadata after the insert trigger)', async () => {
    const deps = makeDeps()
    await createHandler(deps)(req())
    expect(deps.applyProfile).toHaveBeenCalledWith({
      authUserId: 'new-auth',
      role: 'cashier',
      restaurantId: 'rest-1',
      fullName: 'Nuevo',
    })
  })

  it('rolls the auth user back and returns 500 when the profile cannot be applied', async () => {
    const deps = makeDeps({ applyProfile: vi.fn(async () => false) })
    expect((await createHandler(deps)(req())).status).toBe(500)
    expect(deps.deleteUser).toHaveBeenCalledWith('new-auth')
  })

  it('maps weak_password to 400', async () => {
    const deps = makeDeps({ createUser: vi.fn(async () => ({ ok: false as const, reason: 'weak_password' as const })) })
    const res = await createHandler(deps)(req())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('La contraseña no cumple los requisitos de seguridad')
  })

  it('activates the user last, only after apply and read succeeded', async () => {
    const order: string[] = []
    const deps = makeDeps({
      applyProfile: vi.fn(async () => (order.push('apply'), true)),
      readProfile: vi.fn(async () => (order.push('read'), { id: 'p1', full_name: 'N', email: 'e', role: 'cashier' })),
      activateUser: vi.fn(async () => (order.push('activate'), true)),
    })
    expect((await createHandler(deps)(req())).status).toBe(201)
    expect(order).toEqual(['apply', 'read', 'activate'])
    expect(deps.deleteUser).not.toHaveBeenCalled()
  })

  it.each([
    ['applyProfile false', { applyProfile: vi.fn(async () => false) }],
    ['applyProfile throws', { applyProfile: vi.fn(async () => { throw new Error('x') }) }],
    ['readProfile null', { readProfile: vi.fn(async () => null) }],
    ['readProfile throws', { readProfile: vi.fn(async () => { throw new Error('x') }) }],
    ['activateUser false', { activateUser: vi.fn(async () => false) }],
    ['activateUser throws', { activateUser: vi.fn(async () => { throw new Error('x') }) }],
  ])('rolls back with 500 when %s', async (label, over) => {
    const deps = makeDeps(over as Partial<HandlerDeps>)
    const res = await createHandler(deps)(req())
    expect(res.status).toBe(500)
    expect(deps.deleteUser).toHaveBeenCalledWith('new-auth')
    if (!label.startsWith('activateUser')) expect(deps.activateUser).not.toHaveBeenCalled()
  })

  it('still returns 500 when the rollback delete throws too', async () => {
    const deps = makeDeps({
      applyProfile: vi.fn(async () => false),
      deleteUser: vi.fn(async () => { throw new Error('boom') }),
    })
    expect((await createHandler(deps)(req())).status).toBe(500)
  })

  it('returns 500 when getCaller or getCallerProfile throws', async () => {
    const a = makeDeps({ getCaller: vi.fn(async () => { throw new Error('x') }) })
    expect((await createHandler(a)(req())).status).toBe(500)
    const b = makeDeps({ getCallerProfile: vi.fn(async () => { throw new Error('x') }) })
    expect((await createHandler(b)(req())).status).toBe(500)
  })

  it('maps duplicate email to 409 and other failures to 500 without leaking', async () => {
    const dup = makeDeps({ createUser: vi.fn(async () => ({ ok: false as const, reason: 'duplicate' as const })) })
    expect((await createHandler(dup)(req())).status).toBe(409)
    const boom = makeDeps({
      createUser: vi.fn(async () => ({ ok: false as const, reason: 'unknown' as const })),
    })
    const res = await createHandler(boom)(req())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })

  it('returns 500 when the profile cannot be read back', async () => {
    const deps = makeDeps({ readProfile: vi.fn(async () => null) })
    expect((await createHandler(deps)(req())).status).toBe(500)
  })
})

describe('mapCreateUserError', () => {
  it.each([
    ['email_exists', 'duplicate'],
    ['user_already_exists', 'duplicate'],
    ['weak_password', 'weak_password'],
    ['unexpected_failure', 'unknown'],
    [undefined, 'unknown'],
  ])('maps %s to %s', (code, reason) => {
    expect(mapCreateUserError(code)).toBe(reason)
  })
})
