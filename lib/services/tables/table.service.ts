import { TableRepository } from './table.repository'

const repo = new TableRepository()

export const tableService = {
  getAll: () => repo.getAll(),
  updateStatus: (id: string, status: Parameters<typeof repo.updateStatus>[1]) =>
    repo.updateStatus(id, status),
  assignWaiter: (
    id: string,
    waiterId: string,
    status?: Parameters<typeof repo.assignWaiter>[2]
  ) => repo.assignWaiter(id, waiterId, status),
  releaseTable: (id: string) => repo.release(id)
}
