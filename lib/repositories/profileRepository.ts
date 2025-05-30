import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Profile } from '@/types';
import { BaseRepository } from './baseRepository';

export class ProfileRepository extends BaseRepository<Profile> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'profiles');
    }

    /**
     * Obtiene todos los perfiles con un rol específico.
     * @param role El rol a filtrar.
     * @param active Opcional: filtrar por estado activo.
     * @returns Una promesa que resuelve a un array de perfiles.
     */
    async getByRole(role: string, active?: boolean): Promise<Profile[]> {
        try {
            let query = this.supabase
                .from("profiles")
                .select("id, username, full_name, role")
                .eq("role", role)
                .order("full_name");

            if (typeof active === 'boolean') {
                query = query.eq("active", active);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data as unknown as Profile[];
        } catch (error) {
            this.handleError(error, `Error fetching profiles by role (${role}):`);
        }
    }

    /**
     * Crea un nuevo perfil con un rol específico.
     * @param profile Los datos del perfil a crear.
     * @param role El rol a asignar al perfil.
     * @returns Una promesa que resuelve al perfil creado.
     */
    async createProfileWithRole(profile: Omit<Profile, 'id' | 'created_at' | 'updated_at'>, role: string): Promise<Profile> {
        try {
            const { data, error } = await this.supabase
                .from("profiles")
                .insert({
                    ...profile,
                    role: role,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (error) throw error;
            return data as Profile;
        } catch (error) {
            this.handleError(error, `Error creating profile with role ${role}:`);
        }
    }

    /**
     * Actualiza un perfil existente con verificación de rol.
     * @param id El ID del perfil a actualizar.
     * @param payload Los datos parciales del perfil a actualizar.
     * @param role Opcional: el rol que debe tener el perfil para ser actualizado.
     * @returns Una promesa que resuelve al perfil actualizado.
     */
    async updateProfile(id: string, payload: Partial<Profile>, role?: string): Promise<Profile> {
        try {
            let query = this.supabase
                .from("profiles")
                .update({ ...payload, updated_at: new Date().toISOString() })
                .eq("id", id);

            if (role) {
                query = query.eq("role", role);
            }

            const { data, error } = await query.select().single();
            if (error) throw error;
            return data as Profile;
        } catch (error) {
            this.handleError(error, `Error updating profile (${id}) with role ${role || 'any'}:`);
        }
    }

    /**
     * Elimina un perfil con verificación de rol.
     * @param id El ID del perfil a eliminar.
     * @param role Opcional: el rol que debe tener el perfil para ser eliminado.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     */
    async deleteProfile(id: string, role?: string): Promise<boolean> {
        try {
            let query = this.supabase
                .from("profiles")
                .delete()
                .eq("id", id);

            if (role) {
                query = query.eq("role", role);
            }

            const { error } = await query;
            if (error) throw error;
            return true;
        } catch (error) {
            this.handleError(error, `Error deleting profile (${id}) with role ${role || 'any'}:`);
        }
    }
}