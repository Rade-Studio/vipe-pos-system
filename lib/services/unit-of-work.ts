export class UnitOfWork {
  async beginTransaction() {
    // In a real implementation you'd start a DB transaction
  }

  async commit() {
    // Commit transaction
  }

  async rollback() {
    // Rollback transaction
  }
}
