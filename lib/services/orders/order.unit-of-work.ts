import { OrderRepository } from './order.repository'
import { TableRepository } from '../tables/table.repository'
import type { OrderCreate, Order } from './types'

export class OrderUnitOfWork {
  constructor(
    private orderRepo: OrderRepository,
    private tableRepo: TableRepository
  ) {}

  async createOrderAndAssignTable(order: OrderCreate, tableId: string): Promise<Order> {
    await this.orderRepo.beginTransaction()
    try {
      const created = await this.orderRepo.create(order)
      await this.tableRepo.updateStatus(tableId, 'kitchen')
      await this.orderRepo.commit()
      return created
    } catch (err) {
      await this.orderRepo.rollback()
      throw err
    }
  }
}
