import { WaiterRepository } from './waiter.repository'

const repo = new WaiterRepository()

export const waiterService = {
  getAll: () => repo.getAll()
}
