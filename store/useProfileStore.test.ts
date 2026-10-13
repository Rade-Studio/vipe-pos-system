import { beforeEach, describe, expect, it } from 'vitest'
import { useProfileStore } from './useProfileStore'

describe('useProfileStore role picker', () => {
  beforeEach(() => {
    useProfileStore.setState(useProfileStore.getInitialState(), true)
  })

  it('offers one tile per app role for the admin "Cambiar Perfil" picker', () => {
    const roles = useProfileStore.getState().roleProfiles.map((p) => p.role)
    expect(roles).toEqual(['waiter', 'kitchen', 'cashier', 'admin', 'delivery_operator'])
  })

  it('keeps the role tiles when the waiter directory is loaded', () => {
    useProfileStore.getState().setProfiles([
      { id: 'b1e2c3d4-0000-0000-0000-000000000001', name: 'María', role: 'waiter', hasPassword: false },
    ])

    const state = useProfileStore.getState()
    expect(state.profiles.map((p) => p.name)).toEqual(['María'])
    expect(state.roleProfiles.map((p) => p.name)).toEqual(['Mesero', 'Cocina', 'Caja', 'Admin', 'Domicilios'])
  })
})
