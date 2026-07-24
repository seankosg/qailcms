
-- allocate_main_task_no: discipline 기준 신규 Main Task No 제안 (NEW-###)
CREATE OR REPLACE FUNCTION public.allocate_main_task_no(_discipline text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max int := 0;
  v_next text;
  v_lock_key bigint;
  v_seg text;
  v_n int;
  v_rec record;
BEGIN
  IF _discipline IS NULL OR _discipline = '' THEN
    RAISE EXCEPTION 'discipline required';
  END IF;
  v_lock_key := hashtextextended('main_alloc:' || _discipline, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  FOR v_rec IN
    SELECT task_no FROM public.task_management_raw
     WHERE discipline = _discipline
       AND task_no ~ '^NEW-[0-9]+$'
  LOOP
    v_seg := substring(v_rec.task_no FROM 5);
    BEGIN v_n := v_seg::int; IF v_n > v_max THEN v_max := v_n; END IF;
    EXCEPTION WHEN others THEN END;
  END LOOP;

  v_next := 'NEW-' || lpad((v_max + 1)::text, 3, '0');
  WHILE EXISTS (
    SELECT 1 FROM public.task_management_raw
     WHERE discipline = _discipline AND task_no = v_next
  ) LOOP
    v_max := v_max + 1;
    v_next := 'NEW-' || lpad((v_max + 1)::text, 3, '0');
  END LOOP;
  RETURN v_next;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.allocate_main_task_no(text) TO authenticated, service_role;

-- create_main_with_subs: Main Task 1개 + Sub Task N개(>=1) 원자적 생성
CREATE OR REPLACE FUNCTION public.create_main_with_subs(
  _discipline text,
  _main jsonb,
  _subs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_no text;
  v_sub jsonb;
  v_sub_no text;
  v_idx int := 0;
  v_max_sort int := 0;
  v_sort int;
  v_sub_nos text[] := ARRAY[]::text[];
  v_lock_key bigint;
BEGIN
  IF _discipline IS NULL OR _discipline = '' THEN
    RAISE EXCEPTION 'discipline required';
  END IF;
  IF _main IS NULL THEN RAISE EXCEPTION 'main payload required'; END IF;
  IF _subs IS NULL OR jsonb_array_length(_subs) < 1 THEN
    RAISE EXCEPTION 'at least one sub task required';
  END IF;

  v_lock_key := hashtextextended('main_create:' || _discipline, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  v_main_no := NULLIF(trim(_main->>'task_no'), '');
  IF v_main_no IS NULL THEN
    v_main_no := public.allocate_main_task_no(_discipline);
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_management_raw WHERE discipline=_discipline AND task_no=v_main_no) THEN
    RAISE EXCEPTION 'Task No already exists: %', v_main_no;
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort FROM public.task_management_raw WHERE discipline=_discipline;
  v_sort := v_max_sort + 1;

  -- Main 필수 검증
  IF NULLIF(trim(_main->>'task_name'), '') IS NULL THEN RAISE EXCEPTION 'main.task_name required'; END IF;
  IF NULLIF(trim(_main->>'team'), '') IS NULL THEN RAISE EXCEPTION 'main.team required'; END IF;
  IF NULLIF(trim(_main->>'category'), '') IS NULL THEN RAISE EXCEPTION 'main.category required'; END IF;
  IF NULLIF(trim(_main->>'hdec_pic_name'), '') IS NULL THEN RAISE EXCEPTION 'main.hdec_pic_name required'; END IF;
  IF NULLIF(trim(_main->>'risk'), '') IS NULL THEN RAISE EXCEPTION 'main.risk required'; END IF;

  INSERT INTO public.task_management_raw(
    task_no, main_task_no, discipline, level, sort_order,
    task_name, team, category, risk,
    hdec_pic_name, hdec_eng_name, floor_level, location, plot, row_type,
    status_manual, is_rollup
  ) VALUES (
    v_main_no, NULL, _discipline, 'main', v_sort,
    trim(_main->>'task_name'), trim(_main->>'team'), trim(_main->>'category'), trim(_main->>'risk'),
    trim(_main->>'hdec_pic_name'),
    NULLIF(trim(_main->>'hdec_eng_name'), ''),
    NULLIF(trim(_main->>'floor_level'), ''),
    NULLIF(trim(_main->>'location'), ''),
    NULLIF(trim(_main->>'plot'), ''),
    NULLIF(trim(_main->>'row_type'), ''),
    NULL, true
  );

  FOR v_sub IN SELECT * FROM jsonb_array_elements(_subs) LOOP
    v_idx := v_idx + 1;
    v_sub_no := v_main_no || '-' || lpad(v_idx::text, 2, '0');
    v_sort := v_sort + 1;

    IF NULLIF(trim(v_sub->>'task_name'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].task_name required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'sub_task_desc'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].sub_task_desc required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'row_type'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].row_type required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'risk'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].risk required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'hdec_pic_name'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].hdec_pic_name required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'category'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].category required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'plan_start'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].plan_start required', v_idx; END IF;
    IF NULLIF(trim(v_sub->>'plan_end'), '') IS NULL THEN RAISE EXCEPTION 'subs[%].plan_end required', v_idx; END IF;
    IF (v_sub->>'plan_end')::date < (v_sub->>'plan_start')::date THEN
      RAISE EXCEPTION 'subs[%]: plan_end must be >= plan_start', v_idx;
    END IF;

    INSERT INTO public.task_management_raw(
      task_no, main_task_no, discipline, level, sort_order,
      task_name, sub_task_desc, team, category, risk,
      hdec_pic_name, hdec_eng_name, floor_level, location, plot, row_type,
      status_manual, plan_start, plan_end
    ) VALUES (
      v_sub_no, v_main_no, _discipline, 'sub', v_sort,
      trim(v_sub->>'task_name'),
      trim(v_sub->>'sub_task_desc'),
      trim(_main->>'team'),
      trim(v_sub->>'category'),
      trim(v_sub->>'risk'),
      trim(v_sub->>'hdec_pic_name'),
      NULLIF(trim(v_sub->>'hdec_eng_name'), ''),
      NULLIF(trim(v_sub->>'floor_level'), ''),
      NULLIF(trim(v_sub->>'location'), ''),
      NULLIF(trim(_main->>'plot'), ''),
      trim(v_sub->>'row_type'),
      COALESCE(NULLIF(trim(v_sub->>'status_manual'), ''), '예정'),
      (v_sub->>'plan_start')::date,
      (v_sub->>'plan_end')::date
    );
    v_sub_nos := array_append(v_sub_nos, v_sub_no);
  END LOOP;

  PERFORM public.update_task_summary(_discipline, v_main_no);

  RETURN jsonb_build_object('main_task_no', v_main_no, 'sub_task_nos', to_jsonb(v_sub_nos));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_main_with_subs(text, jsonb, jsonb) TO authenticated, service_role;
