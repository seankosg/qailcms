CREATE OR REPLACE FUNCTION public.abd_ocs_norm(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(upper(regexp_replace(coalesce(v, ''), '\s', '', 'g')), '')
$$;

DROP POLICY IF EXISTS "ocs imports admin select" ON storage.objects;
DROP POLICY IF EXISTS "ocs imports admin insert" ON storage.objects;

CREATE POLICY "ocs imports admin select" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'abd-ocs-imports' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ocs imports admin insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'abd-ocs-imports' AND public.has_role(auth.uid(), 'admin'));