import { supabase } from '@/lib/db/client'

export class WaiterRepository {
  async getAll() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, role')
      .eq('role', 'waiter')
      .eq('active', true)
      .order('full_name')
    if (error) throw error
    return data || []
  }

  async create(waiter: any) {
    const { error } = await supabase.from('profiles').insert({
      ...waiter,
      role: 'waiter',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
  }

  async update(id: string, data: any) {
    const { error } = await supabase
      .from('profiles')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  async delete(id: string) {
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) throw error
  }
}
