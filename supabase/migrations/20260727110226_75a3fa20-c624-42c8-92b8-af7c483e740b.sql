CREATE OR REPLACE FUNCTION public.abd_aconex_apply_diffs(
  _batch_id uuid,
  _patches jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'superuser'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: admin/superuser only';
  END IF;

  IF _patches IS NULL OR jsonb_array_length(_patches) = 0 THEN
    RETURN 0;
  END IF;

  WITH src AS (
    SELECT
      (p->>'document_no')                                             AS document_no,
      NULLIF(p->>'latest_status','')                                  AS latest_status,
      NULLIF(p->>'latest_rev','')                                     AS latest_rev,
      CASE WHEN p ? 'approval_date'
           THEN NULLIF(p->>'approval_date','')::date
           ELSE NULL END                                              AS approval_date,
      (p ? 'approval_date')                                           AS has_approval_date,
      NULLIF(p->>'aconex_status_raw','')                              AS aconex_status_raw,
      NULLIF(p->>'aconex_review_status_raw','')                       AS aconex_review_status_raw,
      CASE WHEN p ? 'aconex_date_modified'
           THEN NULLIF(p->>'aconex_date_modified','')::timestamptz
           ELSE NULL END                                              AS aconex_date_modified,
      (p ? 'aconex_date_modified')                                    AS has_aconex_date_modified,
      CASE WHEN p ? 'round_actual'
           THEN NULLIF(p->>'round_actual','')::int
           ELSE NULL END                                              AS round_actual,
      (p ? 'round_actual')                                            AS has_round_actual,
      CASE WHEN p ? 'is_terminated'
           THEN NULLIF(p->>'is_terminated','')::boolean
           ELSE NULL END                                              AS is_terminated,
      (p ? 'is_terminated')                                           AS has_is_terminated
    FROM jsonb_array_elements(_patches) AS p
  ),
  upd AS (
    UPDATE public.abd_items_raw t
    SET
      latest_status            = COALESCE(s.latest_status, t.latest_status),
      latest_rev               = COALESCE(s.latest_rev, t.latest_rev),
      approval_date            = CASE WHEN s.has_approval_date THEN s.approval_date ELSE t.approval_date END,
      aconex_status_raw        = COALESCE(s.aconex_status_raw, t.aconex_status_raw),
      aconex_review_status_raw = COALESCE(s.aconex_review_status_raw, t.aconex_review_status_raw),
      aconex_date_modified     = CASE WHEN s.has_aconex_date_modified THEN s.aconex_date_modified ELSE t.aconex_date_modified END,
      round_actual             = CASE WHEN s.has_round_actual THEN s.round_actual ELSE t.round_actual END,
      is_terminated            = CASE WHEN s.has_is_terminated THEN s.is_terminated ELSE t.is_terminated END,
      aconex_last_synced_at    = now(),
      source_import_log_id     = _batch_id,
      updated_at               = now(),
      updated_by               = v_uid
    FROM src s
    WHERE t.abd_number = s.document_no
    RETURNING 1
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_aconex_apply_diffs(uuid, jsonb) TO service_role;