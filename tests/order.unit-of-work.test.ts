import { describe, it, expect, vi } from 'vitest'
import { OrderUnitOfWork } from '@/lib/services/orders/order.unit-of-work'
import type { OrderCreate } from '@/lib/services/orders/types'

class MockOrderRepo {
  beginTransaction = vi.fn()
  commit = vi.fn()
  rollback = vi.fn()
  create = vi.fn()
}

class MockTableRepo {
  updateStatus = vi.fn()
}

describe('OrderUnitOfWork', () => {
  it('commits when create succeeds', async () => {
    const orderRepo = new MockOrderRepo()
    const tableRepo = new MockTableRepo()
    orderRepo.create.mockResolvedValue({ id: '1' })
    const uow = new OrderUnitOfWork(orderRepo as any, tableRepo as any)
    const order: OrderCreate = {
      table_id: 't1',
      waiter_id: 'w1',
      items: [],
      subtotal: 0,
      tax: 0,
      tax_percentage: 0,
      tip: 0,
      tip_percentage: 0,
      total: 0,
      status: 'pending'
    }
    await uow.createOrderAndAssignTable(order, 't1', [])
    expect(orderRepo.beginTransaction).toHaveBeenCalled()
    expect(orderRepo.commit).toHaveBeenCalled()
    expect(orderRepo.rollback).not.toHaveBeenCalled()
    expect(tableRepo.updateStatus).toHaveBeenCalledWith('t1', 'kitchen')
  })

  it('rolls back on error', async () => {
    const orderRepo = new MockOrderRepo()
    const tableRepo = new MockTableRepo()
    orderRepo.create.mockRejectedValue(new Error('fail'))
    const uow = new OrderUnitOfWork(orderRepo as any, tableRepo as any)
    const order = {
      table_id: 't1',
      waiter_id: 'w1',
      items: [],
      subtotal: 0,
      tax: 0,
      tax_percentage: 0,
      tip: 0,
      tip_percentage: 0,
      total: 0,
      status: 'pending'
    }
    await expect(uow.createOrderAndAssignTable(order, 't1', [])).rejects.toThrow('fail')
    expect(orderRepo.rollback).toHaveBeenCalled()
  })
})
