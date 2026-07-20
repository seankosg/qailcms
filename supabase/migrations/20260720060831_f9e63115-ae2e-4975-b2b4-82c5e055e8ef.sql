
CREATE POLICY "dmr-uploads read auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dmr-uploads');

CREATE POLICY "dmr-uploads write senior+" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dmr-uploads'
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser')
      OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'))
  );

CREATE POLICY "dmr-uploads delete senior+" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dmr-uploads'
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser')
      OR public.has_role(auth.uid(),'d_superuser') OR public.has_role(auth.uid(),'senior_user'))
  );
