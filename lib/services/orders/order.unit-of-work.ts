import { OrderRepository } from './order.repository'
import { TableRepository } from '../tables/table.repository'
import type { OrderCreate, Order } from './types'

export class OrderUnitOfWork {
  constructor(
    private orderRepo: OrderRepository,
    private tableRepo: TableRepository
  ) {}

  async createOrderAndAssignTable(
    order: OrderCreate,
    tableId: string,
    items: any[]
  ): Promise<Order> {
    await this.orderRepo.beginTransaction()
    try {
      const created = await this.orderRepo.create(order)
      if (items.length) {
        await this.orderRepo.addItemsToOrder(created.id, items)
      }
      await this.tableRepo.updateStatus(tableId, 'kitchen')
      await this.orderRepo.commit()
      return created
    } catch (err) {
      await this.orderRepo.rollback()
      throw err
    }
  }
}
