-- ════════════════════════════════════════════════════════════════
-- WRT · SPL 누락 실적 역산 백필 (재임포트 후 1회, 2026-08-08)
-- REVERT: UPDATE ..._stage_progress SET actual_start=NULL, actual_finish=NULL,
--         actual_estimated=false WHERE actual_estimated;
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bf_prev_workday(d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE extract(dow from d) WHEN 5 THEN d - 1 WHEN 6 THEN d - 2 ELSE d END;
$$;

CREATE OR REPLACE FUNCTION public.bf_step(
  m jsonb, code text, a_ord int, aconex boolean, ref date,
  flds text[], offs int[], cells jsonb)
RETURNS TABLE(o_cells jsonb, o_ref date) LANGUAGE plpgsql AS $$
DECLARE s jsonb; d date; i int;
BEGIN
  o_cells := cells; o_ref := ref;
  s := m -> code;
  IF s IS NULL THEN RETURN NEXT; RETURN; END IF;
  IF aconex OR coalesce((s->>'aut')::text,'HDEC') = 'ACONEX'
     OR coalesce((s->>'na')::boolean,false) OR (s->>'so')::int >= a_ord THEN
    RETURN NEXT; RETURN;
  END IF;
  IF s->>'as' IS NOT NULL OR s->>'af' IS NOT NULL THEN
    o_ref := coalesce((s->>'as')::date, (s->>'af')::date);
    RETURN NEXT; RETURN;
  END IF;
  IF ref IS NULL THEN RETURN NEXT; RETURN; END IF;
  FOR i IN 1 .. array_length(flds,1) LOOP
    d := ref - offs[i];
    o_cells := o_cells || jsonb_build_array(jsonb_build_object('stage', code, 'field', flds[i], 'd', d));
    o_ref := d;
  END LOOP;
  RETURN NEXT;
END $$;

DO $bf$
DECLARE
  r record; cells jsonb; c jsonb; i int; ref date; ref2 date;
  prev date; d date; st text; fl text;
BEGIN
  -- ─────────────── WRT (C → D → S 순차, 밴드 넘어도 됨) ───────────────
  FOR r IN
    WITH st AS (
      SELECT i.id AS item_id, c.stage_code, c.sort_order, c.actual_authority,
             p.actual_start AS a_s, p.actual_finish AS a_f, coalesce(p.na_flag,false) AS na
      FROM public.wrt_items i
      CROSS JOIN public.wrt_stage_catalog c
      LEFT JOIN public.wrt_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
      WHERE i.is_active
    ), anc AS (
      SELECT DISTINCT ON (item_id) item_id, sort_order AS a_ord,
             GREATEST(coalesce(a_s, DATE '1900-01-01'), coalesce(a_f, DATE '1900-01-01')) AS a_date
      FROM st WHERE a_s IS NOT NULL OR a_f IS NOT NULL
      ORDER BY item_id, sort_order DESC
    )
    SELECT s.item_id, a.a_ord, a.a_date,
           jsonb_object_agg(s.stage_code, jsonb_build_object(
             'as', s.a_s, 'af', s.a_f, 'na', s.na, 'so', s.sort_order,
             'aut', s.actual_authority)) AS m
    FROM st s JOIN anc a ON a.item_id = s.item_id
    GROUP BY s.item_id, a.a_ord, a.a_date
  LOOP
    cells := '[]'::jsonb;
    ref := coalesce((r.m->'RESPONSE_DATE_R1'->>'as')::date, r.a_date);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'SUBMISSION_R1',    r.a_ord,false,ref, ARRAY['af','as'], ARRAY[12,13], cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'DRAFT_DOC_R1',     r.a_ord,false,ref, ARRAY['af','as'], ARRAY[1,3],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'CONFIRM_QUOTATION',r.a_ord,false,ref, ARRAY['as'],      ARRAY[1],     cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'NEGOTIATION',      r.a_ord,false,ref, ARRAY['af','as'], ARRAY[20,23], cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'RESPONSE_RECEIVED',r.a_ord,false,ref, ARRAY['af','as'], ARRAY[6,8],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'REQ_SUBMISSION',   r.a_ord,false,ref, ARRAY['as'],      ARRAY[4],     cells);

    ref2 := (r.m->'RESPONSE_DATE_R2'->>'as')::date;
    IF ref2 IS NOT NULL THEN
      SELECT o_cells, o_ref INTO cells, ref2 FROM public.bf_step(r.m,'SUBMISSION_R2', r.a_ord,false,ref2,ARRAY['af','as'], ARRAY[12,13], cells);
      SELECT o_cells, o_ref INTO cells, ref2 FROM public.bf_step(r.m,'DRAFT_DOC_R2',  r.a_ord,false,ref2,ARRAY['af','as'], ARRAY[1,3],   cells);
    END IF;

    prev := NULL;
    FOR i IN 0 .. jsonb_array_length(cells) - 1 LOOP
      c := cells -> i;
      d := public.bf_prev_workday((c->>'d')::date);
      IF prev IS NOT NULL AND d > prev THEN d := public.bf_prev_workday(prev); END IF;
      st := c->>'stage'; fl := c->>'field'; prev := d;
      IF fl = 'af' THEN
        INSERT INTO public.wrt_stage_progress(item_id, stage_code, actual_finish, actual_estimated)
        VALUES (r.item_id, st, d, true)
        ON CONFLICT (item_id, stage_code) DO UPDATE
          SET actual_finish = EXCLUDED.actual_finish, actual_estimated = true
          WHERE public.wrt_stage_progress.actual_finish IS NULL
            AND coalesce(public.wrt_stage_progress.na_flag,false) = false;
      ELSE
        INSERT INTO public.wrt_stage_progress(item_id, stage_code, actual_start, actual_estimated)
        VALUES (r.item_id, st, d, true)
        ON CONFLICT (item_id, stage_code) DO UPDATE
          SET actual_start = EXCLUDED.actual_start, actual_estimated = true
          WHERE public.wrt_stage_progress.actual_start IS NULL
            AND coalesce(public.wrt_stage_progress.na_flag,false) = false;
      END IF;
    END LOOP;
  END LOOP;

  -- ─────────────── SPL (Documentation 밴드 안에서만) ───────────────
  FOR r IN
    WITH st AS (
      SELECT i.id AS item_id, c.stage_code, c.sort_order, c.actual_authority,
             p.actual_start AS a_s, p.actual_finish AS a_f, coalesce(p.na_flag,false) AS na
      FROM public.spl_items i
      CROSS JOIN public.spl_stage_catalog c
      LEFT JOIN public.spl_stage_progress p ON p.item_id = i.id AND p.stage_code = c.stage_code
      WHERE c.band = 'DOCUMENTATION'
    ), anc AS (
      SELECT DISTINCT ON (item_id) item_id, sort_order AS a_ord,
             GREATEST(coalesce(a_s, DATE '1900-01-01'), coalesce(a_f, DATE '1900-01-01')) AS a_date
      FROM st WHERE a_s IS NOT NULL OR a_f IS NOT NULL
      ORDER BY item_id, sort_order DESC
    )
    SELECT s.item_id, a.a_ord, a.a_date,
           jsonb_object_agg(s.stage_code, jsonb_build_object(
             'as', s.a_s, 'af', s.a_f, 'na', s.na, 'so', s.sort_order,
             'aut', s.actual_authority)) AS m
    FROM st s JOIN anc a ON a.item_id = s.item_id
    GROUP BY s.item_id, a.a_ord, a.a_date
  LOOP
    cells := '[]'::jsonb;
    ref := coalesce((r.m->'APPROVAL_DATE'->>'as')::date, r.a_date);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'SUBMISSION',          r.a_ord,false,ref, ARRAY['af','as'], ARRAY[18,18], cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'DAR_ACCEPTANCE',      r.a_ord,false,ref, ARRAY['af','as'], ARRAY[1,9],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'SUBSTANTIATION_PREP', r.a_ord,false,ref, ARRAY['af','as'], ARRAY[1,3],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'INTERNAL_QTY_VERIF',  r.a_ord,false,ref, ARRAY['af','as'], ARRAY[1,6],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'REVIEW_RESPONSE',     r.a_ord,false,ref, ARRAY['af','as'], ARRAY[1,5],   cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'RESPONSE_RECEIVED',   r.a_ord,false,ref, ARRAY['as'],      ARRAY[1],     cells);
    SELECT o_cells, o_ref INTO cells, ref FROM public.bf_step(r.m,'REQ_RESUBMISSION',    r.a_ord,false,ref, ARRAY['as'],      ARRAY[7],     cells);

    prev := NULL;
    FOR i IN 0 .. jsonb_array_length(cells) - 1 LOOP
      c := cells -> i;
      d := public.bf_prev_workday((c->>'d')::date);
      IF prev IS NOT NULL AND d > prev THEN d := public.bf_prev_workday(prev); END IF;
      st := c->>'stage'; fl := c->>'field'; prev := d;
      IF fl = 'af' THEN
        INSERT INTO public.spl_stage_progress(item_id, stage_code, actual_finish, actual_estimated)
        VALUES (r.item_id, st, d, true)
        ON CONFLICT (item_id, stage_code) DO UPDATE
          SET actual_finish = EXCLUDED.actual_finish, actual_estimated = true
          WHERE public.spl_stage_progress.actual_finish IS NULL
            AND coalesce(public.spl_stage_progress.na_flag,false) = false;
      ELSE
        INSERT INTO public.spl_stage_progress(item_id, stage_code, actual_start, actual_estimated)
        VALUES (r.item_id, st, d, true)
        ON CONFLICT (item_id, stage_code) DO UPDATE
          SET actual_start = EXCLUDED.actual_start, actual_estimated = true
          WHERE public.spl_stage_progress.actual_start IS NULL
            AND coalesce(public.spl_stage_progress.na_flag,false) = false;
      END IF;
    END LOOP;
  END LOOP;
END $bf$;

DROP FUNCTION IF EXISTS public.bf_step(jsonb, text, int, boolean, date, text[], int[], jsonb);
DROP FUNCTION IF EXISTS public.bf_prev_workday(date);
