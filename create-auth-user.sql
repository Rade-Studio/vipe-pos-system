-- Crear un usuario de prueba para la autenticación
-- Nota: Esto es solo para desarrollo, en producción deberías usar la interfaz de Supabase
-- o crear usuarios con contraseñas seguras

-- Verificar si el usuario ya existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM auth.users WHERE email = 'admin@restaurant.com'
    ) THEN
        -- Insertar un nuevo usuario (la contraseña es 'password123')
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            recovery_sent_at,
            last_sign_in_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        )
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            uuid_generate_v4(),
            'authenticated',
            'authenticated',
            'admin@restaurant.com',
            crypt('password123', gen_salt('bf')),
            now(),
            now(),
            now(),
            '{"provider":"email","providers":["email"]}',
            '{"name":"Administrador"}',
            now(),
            now(),
            '',
            '',
            '',
            ''
        );
        
        RAISE NOTICE 'Usuario de prueba creado: admin@restaurant.com / password123';
    ELSE
        RAISE NOTICE 'El usuario admin@restaurant.com ya existe';
    END IF;
END
$$;
