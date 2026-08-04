-- ============ 1. 컬럼 확장 ============
ALTER TABLE public.abd_ocs_comments
  ADD COLUMN IF NOT EXISTS discipline text,
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS plot text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS source_file_hash text,
  ADD COLUMN IF NOT EXISTS source_imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_note text,
  ADD COLUMN IF NOT EXISTS source_extra jsonb,
  ADD COLUMN IF NOT EXISTS warning_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_priority text;

ALTER TABLE public.abd_ocs_import_logs
  ADD COLUMN IF NOT EXISTS data_file_name text,
  ADD COLUMN IF NOT EXISTS data_file_hash text,
  ADD COLUMN IF NOT EXISTS storage_data_path text,
  ADD COLUMN IF NOT EXISTS storage_manifest_path text,
  ADD COLUMN IF NOT EXISTS snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS attachment_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_registered integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_linked integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_needs_review integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_missing_storage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_orphan_storage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compliance_inserted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mismatch_warning_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warnings jsonb,
  ADD COLUMN IF NOT EXISTS dryrun jsonb;

-- ============ 2. 정규화 정본 함수 ============
CREATE OR REPLACE FUNCTION public.abd_ocs_norm(v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(upper(regexp_replace(coalesce(v, ''), '\s', '', 'g')), '')
$$;

CREATE INDEX IF NOT EXISTS idx_abd_items_raw_abd_number_ocsnorm
  ON public.abd_items_raw (public.abd_ocs_norm(abd_number));

-- ============ 3. 관리자 관문 ============
CREATE OR REPLACE FUNCTION public.abd_ocs_assert_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
END $$;

-- ============ 4. dry-run (쓰기 없음) ============
CREATE OR REPLACE FUNCTION public.abd_ocs_dryrun_batch(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  WITH src AS (
    SELECT x->>'source_comment_id'      AS scid,
           x->>'drawing_number_norm'    AS dnorm,
           x->>'ocs_number_norm'        AS onorm,
           upper(btrim(coalesce(x->>'assessed_code',''))) AS acode,
           x->>'source_row_hash'        AS rhash
    FROM jsonb_array_elements(p_rows) x
  ),
  j AS (
    SELECT s.*,
           a.id   AS abd_id,
           a.team AS abd_team,
           public.abd_ocs_norm(a.abd_ocs_no) AS abd_ocs_norm,
           c.id   AS existing_id,
           c.source_row_hash AS existing_hash,
           EXISTS (SELECT 1 FROM public.abd_ocs_compliance k WHERE k.comment_id = c.id) AS has_compl
    FROM src s
    LEFT JOIN public.abd_items_raw a
           ON public.abd_ocs_norm(a.abd_number) = s.dnorm
    LEFT JOIN public.abd_ocs_comments c
           ON c.source_comment_id = s.scid
  )
  SELECT jsonb_build_object(
    'total',        count(*),
    'new',          count(*) FILTER (WHERE existing_id IS NULL),
    'updated',      count(*) FILTER (WHERE existing_id IS NOT NULL AND existing_hash IS DISTINCT FROM rhash),
    'unchanged',    count(*) FILTER (WHERE existing_id IS NOT NULL AND existing_hash IS NOT DISTINCT FROM rhash),
    'linked',       count(*) FILTER (WHERE abd_id IS NOT NULL),
    'unmatched',    count(*) FILTER (WHERE abd_id IS NULL),
    'mismatch',     count(*) FILTER (WHERE abd_id IS NOT NULL AND onorm IS NOT NULL
                                       AND abd_ocs_norm IS NOT NULL AND abd_ocs_norm <> onorm),
    'bp42c',        count(*) FILTER (WHERE abd_id IS NULL AND dnorm LIKE '%BP42C%'
                                       AND EXISTS (SELECT 1 FROM public.abd_items_raw b
                                                    WHERE public.abd_ocs_norm(b.abd_number)
                                                          = replace(j.dnorm, 'BP42C', 'BP12C'))),
    'team_mech',    count(*) FILTER (WHERE abd_team = 'MECH'),
    'team_elec',    count(*) FILTER (WHERE abd_team = 'ELEC'),
    'team_null',    count(*) FILTER (WHERE abd_id IS NOT NULL AND abd_team IS NULL),
    'new_a',        count(*) FILTER (WHERE existing_id IS NULL AND acode = 'A'),
    'new_a_linked', count(*) FILTER (WHERE existing_id IS NULL AND acode = 'A' AND abd_id IS NOT NULL),
    'abd_ids',      coalesce(jsonb_agg(DISTINCT abd_id) FILTER (WHERE abd_id IS NOT NULL), '[]'::jsonb),
    'dup_in_db',    count(*) FILTER (WHERE has_compl)
  ) INTO res FROM j;

  RETURN res;
END $$;

-- ============ 5. 코멘트 upsert ============
CREATE OR REPLACE FUNCTION public.abd_ocs_import_comments(p_import_log_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb;
  v_abd_id uuid; v_team text; v_abd_ocs text;
  v_existing_id uuid; v_existing_hash text; v_was_active boolean;
  v_dnorm text; v_onorm text; v_acode text;
  v_warn text[]; v_prio text; v_id uuid;
  n_ins int := 0; n_upd int := 0; n_same int := 0;
  n_link int := 0; n_unm int := 0; n_mis int := 0; n_bp int := 0; n_compl int := 0;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_dnorm := public.abd_ocs_norm(r->>'source_drawing_number');
    v_onorm := public.abd_ocs_norm(r->>'ocs_number');
    v_acode := upper(btrim(coalesce(r->>'assessed_code','')));
    v_warn  := '{}'::text[];
    v_prio  := NULL;

    SELECT a.id, a.team, public.abd_ocs_norm(a.abd_ocs_no)
      INTO v_abd_id, v_team, v_abd_ocs
      FROM public.abd_items_raw a
     WHERE public.abd_ocs_norm(a.abd_number) = v_dnorm
     LIMIT 2;

    IF (SELECT count(*) FROM public.abd_items_raw a
         WHERE public.abd_ocs_norm(a.abd_number) = v_dnorm) > 1 THEN
      RAISE EXCEPTION 'multiple ABD candidates for %', v_dnorm;
    END IF;

    IF v_abd_id IS NOT NULL THEN
      n_link := n_link + 1;
      IF v_onorm IS NOT NULL AND v_abd_ocs IS NOT NULL AND v_abd_ocs <> v_onorm THEN
        v_warn := array_append(v_warn, 'OCS_NUMBER_MISMATCH');
        n_mis := n_mis + 1;
      END IF;
    ELSE
      v_team := NULL;
      n_unm := n_unm + 1;
      IF v_dnorm LIKE '%BP42C%' AND EXISTS (
        SELECT 1 FROM public.abd_items_raw b
         WHERE public.abd_ocs_norm(b.abd_number) = replace(v_dnorm, 'BP42C', 'BP12C')
      ) THEN
        v_prio := 'MANUAL_REVIEW_BP42C_BP12C';
        v_warn := array_append(v_warn, 'MANUAL_REVIEW_BP42C_BP12C');
        n_bp := n_bp + 1;
      END IF;
    END IF;

    SELECT id, source_row_hash, is_active
      INTO v_existing_id, v_existing_hash, v_was_active
      FROM public.abd_ocs_comments WHERE source_comment_id = r->>'source_comment_id';

    IF v_existing_id IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM (r->>'source_row_hash')
       AND v_was_active THEN
      -- 링크/팀/경고는 현재 ABD 기준으로 항상 최신화(업무 데이터 아님)
      UPDATE public.abd_ocs_comments
         SET abd_item_id = v_abd_id,
             link_status = CASE WHEN v_abd_id IS NULL THEN 'unmatched' ELSE 'linked' END,
             link_method = CASE WHEN v_abd_id IS NULL THEN NULL ELSE 'drawing_exact' END,
             linked_at   = CASE WHEN v_abd_id IS NULL THEN NULL ELSE coalesce(linked_at, now()) END,
             team = v_team, warning_codes = v_warn, review_priority = v_prio,
             drawing_number_norm = v_dnorm, ocs_number_norm = v_onorm
       WHERE id = v_existing_id;
      n_same := n_same + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.abd_ocs_comments (
      source_comment_id, ocs_number, ocs_number_norm, source_drawing_number, drawing_number_norm,
      ocs_sn, file_revision, comment_revision, comment_part, ocs_comment, assessed_code,
      contractor_response, sign_off_status, source_file_name, source_sheet_name, source_row_index,
      source_row_hash, source_file_hash, source_modified_at, source_imported_at, validation_note,
      discipline, service, plot, project, source_extra,
      import_log_id, abd_item_id, link_status, link_method, linked_at, team,
      warning_codes, review_priority, is_active, inactive_at, retired_reason
    ) VALUES (
      r->>'source_comment_id', r->>'ocs_number', v_onorm, r->>'source_drawing_number', v_dnorm,
      r->>'ocs_sn', r->>'file_revision', r->>'comment_revision', r->>'comment_part',
      r->>'ocs_comment', r->>'assessed_code',
      r->>'contractor_response', r->>'sign_off_status', r->>'source_file_name',
      r->>'source_sheet_name', nullif(r->>'source_row_index','')::int,
      r->>'source_row_hash', r->>'source_file_hash',
      nullif(r->>'source_modified_at','')::timestamptz, nullif(r->>'source_imported_at','')::timestamptz,
      r->>'validation_note',
      r->>'discipline', r->>'service', r->>'plot', r->>'project', r->'source_extra',
      p_import_log_id, v_abd_id,
      CASE WHEN v_abd_id IS NULL THEN 'unmatched' ELSE 'linked' END,
      CASE WHEN v_abd_id IS NULL THEN NULL ELSE 'drawing_exact' END,
      CASE WHEN v_abd_id IS NULL THEN NULL ELSE now() END,
      v_team, v_warn, v_prio, true, NULL, NULL
    )
    ON CONFLICT (source_comment_id) DO UPDATE SET
      ocs_number = EXCLUDED.ocs_number, ocs_number_norm = EXCLUDED.ocs_number_norm,
      source_drawing_number = EXCLUDED.source_drawing_number,
      drawing_number_norm = EXCLUDED.drawing_number_norm,
      ocs_sn = EXCLUDED.ocs_sn, file_revision = EXCLUDED.file_revision,
      comment_revision = EXCLUDED.comment_revision, comment_part = EXCLUDED.comment_part,
      ocs_comment = EXCLUDED.ocs_comment, assessed_code = EXCLUDED.assessed_code,
      contractor_response = EXCLUDED.contractor_response,
      sign_off_status = EXCLUDED.sign_off_status,
      source_file_name = EXCLUDED.source_file_name,
      source_sheet_name = EXCLUDED.source_sheet_name,
      source_row_index = EXCLUDED.source_row_index,
      source_row_hash = EXCLUDED.source_row_hash,
      source_file_hash = EXCLUDED.source_file_hash,
      source_modified_at = EXCLUDED.source_modified_at,
      source_imported_at = EXCLUDED.source_imported_at,
      validation_note = EXCLUDED.validation_note,
      discipline = EXCLUDED.discipline, service = EXCLUDED.service,
      plot = EXCLUDED.plot, project = EXCLUDED.project, source_extra = EXCLUDED.source_extra,
      import_log_id = EXCLUDED.import_log_id,
      abd_item_id = EXCLUDED.abd_item_id, link_status = EXCLUDED.link_status,
      link_method = EXCLUDED.link_method,
      linked_at = coalesce(public.abd_ocs_comments.linked_at, EXCLUDED.linked_at),
      team = EXCLUDED.team, warning_codes = EXCLUDED.warning_codes,
      review_priority = EXCLUDED.review_priority,
      is_active = true, inactive_at = NULL, retired_reason = NULL,
      updated_at = now()
    RETURNING id INTO v_id;

    IF v_existing_id IS NULL THEN
      n_ins := n_ins + 1;
      IF v_acode = 'A' THEN
        INSERT INTO public.abd_ocs_compliance (comment_id, complied, source, complied_by, complied_by_name, complied_at)
        VALUES (v_id, true, 'import_status_a', NULL, NULL, now())
        ON CONFLICT (comment_id) DO NOTHING;
        IF FOUND THEN
          n_compl := n_compl + 1;
          INSERT INTO public.abd_ocs_compliance_log
            (comment_id, abd_item_id, source_comment_id, abd_number, ocs_number,
             old_complied, new_complied, source, changed_by, changed_by_name)
          VALUES (v_id, v_abd_id, r->>'source_comment_id',
                  r->>'source_drawing_number', r->>'ocs_number',
                  NULL, true, 'import_status_a', NULL, NULL);
        END IF;
      END IF;
    ELSE
      n_upd := n_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'unchanged', n_same,
                            'linked', n_link, 'unmatched', n_unm, 'mismatch', n_mis,
                            'bp42c', n_bp, 'compliance_inserted', n_compl);
END $$;

-- ============ 6. 첨부 upsert ============
CREATE OR REPLACE FUNCTION public.abd_ocs_import_attachments(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; v_cid uuid; v_exist record;
  n_ins int := 0; n_upd int := 0; n_same int := 0; n_link int := 0; n_nr int := 0;
  conflicts jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_cid := NULL;
    IF r->>'source_comment_id' IS NOT NULL THEN
      SELECT id INTO v_cid FROM public.abd_ocs_comments
       WHERE source_comment_id = r->>'source_comment_id';
    END IF;

    SELECT * INTO v_exist FROM public.abd_ocs_attachments
     WHERE source_attachment_id = r->>'source_attachment_id';

    IF v_exist.id IS NOT NULL
       AND (v_exist.storage_path IS DISTINCT FROM (r->>'storage_path')
            OR (r->>'content_hash' IS NOT NULL AND v_exist.content_hash IS NOT NULL
                AND v_exist.content_hash IS DISTINCT FROM (r->>'content_hash'))) THEN
      conflicts := conflicts || jsonb_build_object(
        'source_attachment_id', r->>'source_attachment_id',
        'db_path', v_exist.storage_path, 'new_path', r->>'storage_path',
        'db_hash', v_exist.content_hash, 'new_hash', r->>'content_hash');
      CONTINUE;
    END IF;

    IF v_cid IS NULL THEN n_nr := n_nr + 1; ELSE n_link := n_link + 1; END IF;

    IF v_exist.id IS NULL THEN
      INSERT INTO public.abd_ocs_attachments (
        source_attachment_id, source_comment_id, comment_id, storage_path, content_hash,
        byte_size, width, height, image_format, mime_type, source_image_index, sort_order, link_status)
      VALUES (
        r->>'source_attachment_id', r->>'source_comment_id', v_cid, r->>'storage_path',
        r->>'content_hash', nullif(r->>'byte_size','')::bigint,
        nullif(r->>'width','')::int, nullif(r->>'height','')::int,
        r->>'image_format', r->>'mime_type',
        nullif(r->>'source_image_index','')::int,
        coalesce(nullif(r->>'source_image_index','')::int, 0),
        CASE WHEN v_cid IS NULL THEN 'needs_review' ELSE 'linked' END);
      n_ins := n_ins + 1;
    ELSE
      UPDATE public.abd_ocs_attachments SET
        source_comment_id = r->>'source_comment_id',
        comment_id = v_cid,
        content_hash = coalesce(r->>'content_hash', content_hash),
        byte_size = coalesce(nullif(r->>'byte_size','')::bigint, byte_size),
        width = coalesce(nullif(r->>'width','')::int, width),
        height = coalesce(nullif(r->>'height','')::int, height),
        image_format = coalesce(r->>'image_format', image_format),
        mime_type = coalesce(r->>'mime_type', mime_type),
        source_image_index = coalesce(nullif(r->>'source_image_index','')::int, source_image_index),
        sort_order = coalesce(nullif(r->>'source_image_index','')::int, sort_order),
        link_status = CASE WHEN v_cid IS NULL THEN 'needs_review' ELSE 'linked' END
      WHERE id = v_exist.id;
      IF v_exist.comment_id IS DISTINCT FROM v_cid THEN n_upd := n_upd + 1; ELSE n_same := n_same + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'unchanged', n_same,
                            'linked', n_link, 'needs_review', n_nr, 'conflicts', conflicts);
END $$;

-- ============ 7. 마감(부재 코멘트 비활성) ============
CREATE OR REPLACE FUNCTION public.abd_ocs_finalize_comments(p_source_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  UPDATE public.abd_ocs_comments
     SET is_active = false, inactive_at = now(), retired_reason = 'absent_in_source', updated_at = now()
   WHERE is_active = true AND NOT (source_comment_id = ANY(p_source_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('inactivated', n);
END $$;

-- ============ 8. 검증 ============
CREATE OR REPLACE FUNCTION public.abd_ocs_verify()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  PERFORM public.abd_ocs_assert_admin();
  SELECT jsonb_build_object(
    'comments_total', (SELECT count(*) FROM public.abd_ocs_comments),
    'comments_active', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active),
    'comments_linked', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND link_status='linked'),
    'comments_unmatched', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND link_status='unmatched'),
    'unique_abd', (SELECT count(DISTINCT abd_item_id) FROM public.abd_ocs_comments WHERE abd_item_id IS NOT NULL),
    'mismatch_warning', (SELECT count(*) FROM public.abd_ocs_comments WHERE 'OCS_NUMBER_MISMATCH' = ANY(warning_codes)),
    'bp42c_priority', (SELECT count(*) FROM public.abd_ocs_comments WHERE review_priority = 'MANUAL_REVIEW_BP42C_BP12C'),
    'team_mech', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND team='MECH'),
    'team_elec', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND team='ELEC'),
    'team_null', (SELECT count(*) FROM public.abd_ocs_comments WHERE is_active AND team IS NULL),
    'compliance_rows', (SELECT count(*) FROM public.abd_ocs_compliance),
    'compliance_a_linked', (SELECT count(*) FROM public.abd_ocs_compliance k
                              JOIN public.abd_ocs_comments c ON c.id = k.comment_id
                             WHERE k.source='import_status_a' AND c.abd_item_id IS NOT NULL),
    'compliance_log_rows', (SELECT count(*) FROM public.abd_ocs_compliance_log),
    'attachments_total', (SELECT count(*) FROM public.abd_ocs_attachments),
    'attachments_linked', (SELECT count(*) FROM public.abd_ocs_attachments WHERE link_status='linked'),
    'attachments_needs_review', (SELECT count(*) FROM public.abd_ocs_attachments WHERE link_status='needs_review'),
    'storage_paths', (SELECT coalesce(jsonb_agg(storage_path), '[]'::jsonb) FROM public.abd_ocs_attachments)
  ) INTO res;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_dryrun_batch(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_import_comments(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_import_attachments(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_finalize_comments(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.abd_ocs_verify() FROM anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_dryrun_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_import_comments(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_import_attachments(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_finalize_comments(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_verify() TO authenticated;