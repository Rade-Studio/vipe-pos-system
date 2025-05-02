-- Este script configura políticas de acceso público para el bucket "dishes"
-- Ejecutar este script en la consola SQL de Supabase

-- Asegurarse de que el bucket existe
INSERT INTO storage.buckets (id, name, public)
VALUES ('dishes', 'dishes', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Eliminar políticas existentes para el bucket "dishes"
DELETE FROM storage.policies WHERE bucket_id = 'dishes';

-- Crear política para permitir lectura pública (anónima)
INSERT INTO storage.policies (bucket_id, name, definition, allow_anonymous)
VALUES (
  'dishes',
  'Public Read',
  '(bucket_id = ''dishes''::text)',
  true
);

-- Crear política para permitir escritura a usuarios autenticados
INSERT INTO storage.policies (bucket_id, name, definition, allow_anonymous)
VALUES (
  'dishes',
  'Authenticated Upload',
  '(bucket_id = ''dishes''::text AND (role() = ''authenticated''::text OR role() = ''service_role''::text))',
  false
);

-- Crear política para permitir eliminación a usuarios autenticados
INSERT INTO storage.policies (bucket_id, name, definition, allow_anonymous)
VALUES (
  'dishes',
  'Authenticated Delete',
  '(bucket_id = ''dishes''::text AND (role() = ''authenticated''::text OR role() = ''service_role''::text))',
  false
);

-- Asegurarse de que el bucket es público
UPDATE storage.buckets SET public = true WHERE id = 'dishes';
