
DROP POLICY IF EXISTS "Authenticated can insert history" ON public.spare_part_status_history;

CREATE POLICY "Authenticated can insert history"
  ON public.spare_part_status_history FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    OR public.is_admin_or_super(auth.uid())
  );
