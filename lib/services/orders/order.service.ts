import { OrderRepository } from './order.repository'
import { TableRepository } from '../tables/table.repository'
import type { OrderCreate, Order } from './types'
import { OrderUnitOfWork } from './order.unit-of-work'

const orderRepo = new OrderRepository()
const tableRepo = new TableRepository()
const uow = new OrderUnitOfWork(orderRepo, tableRepo)

export const orderService = {
  createOrderAndAssignTable: (
    order: OrderCreate,
    tableId: string
  ): Promise<Order> => uow.createOrderAndAssignTable(order, tableId),
  getById: (id: string) => orderRepo.getById(id)
}
