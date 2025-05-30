import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { CashRegister, CashTransaction } from '@/types/cash-register';
import { BaseRepository } from './baseRepository';

export class CashRegisterRepository extends BaseRepository<CashRegister> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'cash_registers');
    }

    async getCurrentOpenRegister(): Promise<CashRegister | null> {
        try {
            const { data, error } = await this.supabase
                .from('cash_registers')
                .select('*')
                .eq('status', 'open')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code === 'PGRST116') {
                return null;
            }
            if (error) throw error;
            return data as CashRegister;
        } catch (error) {
            this.handleError(error, 'Error fetching current open cash register:');
        }
    }

    async openRegister(initialBalance: number, userId: string): Promise<CashRegister> {
        try {
            const { data, error } = await this.supabase
                .from('cash_registers')
                .insert({
                    initial_balance: initialBalance,
                    current_balance: initialBalance,
                    status: 'open',
                    opened_by_user_id: userId,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();
            if (error) throw error;
            return data as CashRegister;
        } catch (error) {
            this.handleError(error, 'Error opening cash register:');
        }
    }

    async closeRegister(registerId: string, finalBalance: number, userId: string): Promise<CashRegister> {
        try {
            const { data, error } = await this.supabase
                .from('cash_registers')
                .update({
                    final_balance: finalBalance,
                    current_balance: finalBalance,
                    status: 'closed',
                    closed_by_user_id: userId,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', registerId)
                .select()
                .single();
            if (error) throw error;
            return data as CashRegister;
        } catch (error) {
            this.handleError(error, 'Error closing cash register:');
        }
    }

    // Métodos para transacciones de caja si también las manejas aquí
    async addCashTransaction(transaction: { register_id: string; amount: number; type: 'deposit' | 'withdrawal'; reason: string; user_id: string }): Promise<CashTransaction> {
        try {
            // Actualizar el balance actual del registro
            const { data: register, error: fetchRegisterError } = await this.supabase
                .from('cash_registers')
                .select('current_balance')
                .eq('id', transaction.register_id)
                .single();

            if (fetchRegisterError || !register) {
                throw new Error('Cash register not found.');
            }

            let newBalance = register.current_balance;
            if (transaction.type === 'deposit') {
                newBalance += transaction.amount;
            } else {
                newBalance -= transaction.amount;
            }

            const { data: updatedRegister, error: updateRegisterError } = await this.supabase
                .from('cash_registers')
                .update({ current_balance: newBalance, updated_at: new Date().toISOString() })
                .eq('id', transaction.register_id)
                .select()
                .single();

            if (updateRegisterError) throw updateRegisterError;

            // Insertar la transacción
            const { data, error } = await this.supabase
                .from('cash_transactions')
                .insert({
                    cash_register_id: transaction.register_id,
                    amount: transaction.amount,
                    type: transaction.type,
                    reason: transaction.reason,
                    user_id: transaction.user_id,
                    created_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (error) throw error;
            return data as CashTransaction;
        } catch (error) {
            this.handleError(error, 'Error adding cash transaction:');
        }
    }
}