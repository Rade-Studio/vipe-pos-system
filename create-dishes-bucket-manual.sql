-- Este script debe ejecutarse desde el panel de SQL de Supabase
-- con permisos de administrador

-- Crear el bucket 'dishes'
INSERT INTO storage.buckets (id, name, public)
VALUES ('dishes', 'dishes', true);

-- Permitir acceso de lectura a archivos públicos para usuarios anónimos
CREATE POLICY "Permitir acceso público de lectura para dishes"
ON storage.objects FOR SELECT
USING (bucket_id = 'dishes' AND auth.role() = 'anon');

-- Permitir a usuarios autenticados subir archivos
CREATE POLICY "Permitir a usuarios autenticados subir archivos a dishes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'dishes');

-- Permitir a usuarios autenticados actualizar sus propios archivos
CREATE POLICY "Permitir a usuarios autenticados actualizar sus propios archivos en dishes"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'dishes' AND owner = auth.uid());

-- Permitir a usuarios autenticados eliminar sus propios archivos
CREATE POLICY "Permitir a usuarios autenticados eliminar sus propios archivos en dishes"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'dishes' AND owner = auth.uid());
