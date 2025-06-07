export type TableStatus = 'available' | 'reserved' | 'occupied' | 'kitchen' | 'served'

export interface Table {
  id: string
  number: number
  status: TableStatus
  waiter_id?: string | null
  waiter_name?: string | null
}
