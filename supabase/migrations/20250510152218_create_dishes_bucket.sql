-- Crear el bucket "dishes" si no existe
INSERT INTO storage.buckets (id, name)
VALUES ('dishes', 'dishes')
ON CONFLICT (id) DO NOTHING;

-- Política para permitir acceso público de lectura
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'dishes');

-- Permitir a usuarios autenticados insertar en el bucket
CREATE POLICY "Authenticated Users Can Upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dishes' AND auth.role() = 'authenticated');

-- Permitir a usuarios autenticados actualizar sus propios objetos
CREATE POLICY "Authenticated Users Can Update Own Objects"
ON storage.objects FOR UPDATE
USING (bucket_id = 'dishes' AND auth.uid() = owner);

-- Permitir a usuarios autenticados eliminar sus propios objetos
CREATE POLICY "Authenticated Users Can Delete Own Objects"
ON storage.objects FOR DELETE
USING (bucket_id = 'dishes' AND auth.uid() = owner);

-- Política para permitir acceso anónimo (sin autenticación)
CREATE POLICY "Allow Anonymous Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'dishes');

-- Política para permitir carga anónima (sin autenticación)
CREATE POLICY "Allow Anonymous Upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dishes');

-- Política para permitir actualización anónima (sin autenticación)
CREATE POLICY "Allow Anonymous Update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'dishes');

-- Política para permitir eliminación anónima (sin autenticación)
CREATE POLICY "Allow Anonymous Delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'dishes');

