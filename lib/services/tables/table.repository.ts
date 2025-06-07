import { supabase } from '@/lib/db/client'
import type { Table, TableStatus } from './types'
import { UnitOfWork } from '../unit-of-work'

export class TableRepository extends UnitOfWork {
  async getAll(): Promise<Table[]> {
    const { data, error } = await supabase
      .from('tables')
      .select('*, profiles(id, full_name)')
      .order('number')
    if (error) throw error
    return (
      data?.map((t) => ({
        id: t.id,
        number: t.number,
        status: t.status as TableStatus,
        waiter_id: t.waiter_id,
        waiter_name: t.profiles ? t.profiles.full_name : null
      })) || []
    )
  }

  async updateStatus(id: string, status: TableStatus): Promise<Table | null> {
    const { data, error } = await supabase
      .from('tables')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Table
  }

  async assignWaiter(
    tableId: string,
    waiterId: string,
    status: TableStatus = 'reserved'
  ): Promise<Table | null> {
    const { data, error } = await supabase
      .from('tables')
      .update({
        waiter_id: waiterId,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', tableId)
      .select()
      .single()
    if (error) throw error
    return data as Table
  }

  async release(tableId: string): Promise<Table | null> {
    const { data, error } = await supabase
      .from('tables')
      .update({
        waiter_id: null,
        status: 'available',
        updated_at: new Date().toISOString()
      })
      .eq('id', tableId)
      .select()
      .single()
    if (error) throw error
    return data as Table
  }
}
