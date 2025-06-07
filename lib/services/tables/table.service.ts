import { TableRepository } from './table.repository'

const repo = new TableRepository()

export const tableService = {
  getAll: () => repo.getAll(),
  updateStatus: (id: string, status: Parameters<typeof repo.updateStatus>[1]) =>
    repo.updateStatus(id, status)
}
