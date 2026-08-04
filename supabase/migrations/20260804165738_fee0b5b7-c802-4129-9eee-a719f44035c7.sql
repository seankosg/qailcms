CREATE POLICY "abd_ocs_att_admin_select" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'abd-ocs-attachments' AND public.is_admin_or_super(auth.uid()));

CREATE POLICY "abd_ocs_att_admin_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'abd-ocs-attachments' AND public.is_admin_or_super(auth.uid()));

CREATE POLICY "abd_ocs_att_admin_update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'abd-ocs-attachments' AND public.is_admin_or_super(auth.uid()))
WITH CHECK (bucket_id = 'abd-ocs-attachments' AND public.is_admin_or_super(auth.uid()));

CREATE POLICY "abd_ocs_att_admin_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'abd-ocs-attachments' AND public.is_admin_or_super(auth.uid()));