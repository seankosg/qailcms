CREATE TABLE public.abd_ocs_source_files (
  id uuid primary key default gen_random_uuid(),
  source_file_id text not null unique,
  file_name text not null,
  relative_path text not null,
  storage_path text not null unique,
  content_hash text not null unique,
  byte_size bigint not null,
  mime_type text not null,
  is_active boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

GRANT SELECT ON public.abd_ocs_source_files TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.abd_ocs_source_files TO authenticated;
GRANT ALL ON public.abd_ocs_source_files TO service_role;

ALTER TABLE public.abd_ocs_source_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abd_ocs_source_files_read" ON public.abd_ocs_source_files
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_ocs_source_files_admin_write" ON public.abd_ocs_source_files
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX abd_ocs_source_files_file_name_idx
  ON public.abd_ocs_source_files (file_name, is_active, uploaded_at DESC);

CREATE POLICY "abd_ocs_src_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'abd-ocs-source-files' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "abd_ocs_src_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'abd-ocs-source-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.abd_ocs_source_files f
        JOIN public.abd_ocs_comments c ON c.source_file_name = f.file_name
        WHERE f.storage_path = objects.name
          AND public.abd_ocs_comment_visible(c.id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.abd_ocs_source_file_for_comment(_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_row public.abd_ocs_source_files%ROWTYPE;
BEGIN
  IF NOT public.abd_ocs_comment_visible(_comment_id) THEN
    RAISE EXCEPTION 'OCS_FORBIDDEN_READ';
  END IF;

  SELECT c.source_file_name INTO v_name
  FROM public.abd_ocs_comments c WHERE c.id = _comment_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT * INTO v_row
  FROM public.abd_ocs_source_files f
  WHERE f.file_name = v_name AND f.is_active
  ORDER BY f.uploaded_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'file_name', v_name);
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'source_file_id', v_row.source_file_id,
    'file_name', v_row.file_name,
    'storage_path', v_row.storage_path,
    'byte_size', v_row.byte_size
  );
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_source_file_for_comment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.abd_ocs_source_file_for_comment(uuid) TO authenticated;