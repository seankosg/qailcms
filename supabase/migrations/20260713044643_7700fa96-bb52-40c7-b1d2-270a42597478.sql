CREATE OR REPLACE FUNCTION public.allocate_task_no(
  _discipline text,
  _parent_task_no text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent public.task_management_raw%ROWTYPE;
  v_max int := 0;
  v_next text;
  v_lock_key bigint;
  v_suffix text;
  v_seg text;
  v_n int;
  v_rec record;
BEGIN
  IF _discipline IS NULL OR _discipline = '' THEN
    RAISE EXCEPTION 'discipline required';
  END IF;

  -- Advisory lock: prevent concurrent allocations on the same parent
  v_lock_key := hashtextextended(_discipline || ':' || COALESCE(_parent_task_no, '~ROOT~'), 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF _parent_task_no IS NOT NULL AND _parent_task_no <> '' THEN
    SELECT * INTO v_parent
      FROM public.task_management_raw
     WHERE discipline = _discipline AND task_no = _parent_task_no
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent task not found: %', _parent_task_no;
    END IF;

    -- Find highest first-segment among direct children matching '<parent>-NN...'
    FOR v_rec IN
      SELECT task_no
        FROM public.task_management_raw
       WHERE discipline = _discipline
         AND task_no LIKE _parent_task_no || '-%'
    LOOP
      v_suffix := substring(v_rec.task_no FROM length(_parent_task_no) + 2);
      v_seg := split_part(v_suffix, '-', 1);
      BEGIN
        v_n := v_seg::int;
        IF v_n > v_max THEN v_max := v_n; END IF;
      EXCEPTION WHEN others THEN
        -- non-numeric child suffix; ignore
      END;
    END LOOP;

    v_next := _parent_task_no || '-' || lpad((v_max + 1)::text, 2, '0');
  ELSE
    -- Root: numeric-only task_no in same discipline, max+1 as 3-digit
    SELECT COALESCE(MAX(task_no::int), 0) INTO v_max
      FROM public.task_management_raw
     WHERE discipline = _discipline
       AND (parent_task_no IS NULL OR parent_task_no = '')
       AND task_no ~ '^[0-9]+$';
    v_next := lpad((v_max + 1)::text, 3, '0');
  END IF;

  -- Safety: ensure not collide (should not happen thanks to advisory lock)
  WHILE EXISTS (
    SELECT 1 FROM public.task_management_raw
     WHERE discipline = _discipline AND task_no = v_next
  ) LOOP
    v_max := v_max + 1;
    IF _parent_task_no IS NOT NULL AND _parent_task_no <> '' THEN
      v_next := _parent_task_no || '-' || lpad((v_max + 1)::text, 2, '0');
    ELSE
      v_next := lpad((v_max + 1)::text, 3, '0');
    END IF;
  END LOOP;

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.allocate_task_no(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.allocate_task_no(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_task_no(text, text) TO service_role;