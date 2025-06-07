import { supabase } from '@/lib/supabase/client'
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
}
