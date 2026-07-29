DROP POLICY IF EXISTS "Allow authenticated read on db-backups" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload on db-backups" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete own on db-backups" ON storage.objects;

CREATE POLICY "Admins can read db backups"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'db-backups'
  AND public.is_admin_or_super(auth.uid())
);

CREATE POLICY "Admins can upload db backups"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'db-backups'
  AND public.is_admin_or_super(auth.uid())
);

CREATE POLICY "Admins can delete db backups"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'db-backups'
  AND public.is_admin_or_super(auth.uid())
);