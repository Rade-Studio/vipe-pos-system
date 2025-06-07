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
  getById: (id: string) => orderRepo.getById(id),
  getByStatus: (statuses: Order['status'][]) => orderRepo.getByStatus(statuses),
  addItemsToOrder: (orderId: string, items: any[]) =>
    orderRepo.addItemsToOrder(orderId, items),
  recalcTotals: (orderId: string) => orderRepo.recalculateOrderTotals(orderId),
  updateStatus: (id: string, status: Order['status']) =>
    orderRepo.updateStatus(id, status),
  deleteOrder: (id: string) => orderRepo.deleteOrder(id),
  createPartialOrder: (
    parentId: string,
    items: any[],
    bill: any
  ) => orderRepo.createPartialOrder(parentId, items, bill),
  deletePartialOrder: (id: string) => orderRepo.deletePartialOrder(id),
  updateItemStatus: (id: string, status: string) =>
    orderRepo.updateItemStatus(id, status),
  updateItemsStatus: (ids: string[], status: string) =>
    orderRepo.updateItemsStatus(ids, status),
  deleteItem: (id: string) => orderRepo.deleteItem(id),
  deletePendingItems: (orderId: string) => orderRepo.deletePendingItems(orderId),
  getDetailedByStatus: (statuses: Order['status'][]) =>
    orderRepo.getDetailedByStatus(statuses)
}
