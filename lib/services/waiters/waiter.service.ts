import { WaiterRepository } from './waiter.repository'

const repo = new WaiterRepository()

export const waiterService = {
  getAll: () => repo.getAll(),
  create: (waiter: any) => repo.create(waiter),
  update: (id: string, data: any) => repo.update(id, data),
  delete: (id: string) => repo.delete(id)
}
