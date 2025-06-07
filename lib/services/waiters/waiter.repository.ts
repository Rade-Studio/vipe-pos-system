import { supabase } from '@/lib/supabase/client'

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
}
