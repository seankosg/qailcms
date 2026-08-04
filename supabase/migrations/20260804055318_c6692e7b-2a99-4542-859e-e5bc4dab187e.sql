
-- ===== 1) 정규화 한 벌로 통일 (upper) =====
CREATE OR REPLACE FUNCTION public.hdec_name_norm(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT upper(btrim(regexp_replace(coalesce(_name,''), '\s+', ' ', 'g'))) $$;

DROP INDEX IF EXISTS public.hdec_eng_name_master_name_norm_key;
DROP INDEX IF EXISTS public.hdec_pic_name_master_name_norm_key;
DROP INDEX IF EXISTS public.ux_hdec_eng_name_master_norm;
DROP INDEX IF EXISTS public.ux_hdec_pic_name_master_norm;

UPDATE public.hdec_eng_name_master SET name_norm = public.hdec_name_norm(name)
 WHERE name_norm IS DISTINCT FROM public.hdec_name_norm(name);
UPDATE public.hdec_pic_name_master SET name_norm = public.hdec_name_norm(name)
 WHERE name_norm IS DISTINCT FROM public.hdec_name_norm(name);

CREATE UNIQUE INDEX ux_hdec_eng_name_master_norm ON public.hdec_eng_name_master(name_norm);
CREATE UNIQUE INDEX ux_hdec_pic_name_master_norm ON public.hdec_pic_name_master(name_norm);

ALTER TABLE public.hdec_eng_name_master ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.hdec_pic_name_master ADD COLUMN IF NOT EXISTS note text;

-- ===== 2) SPL / WRT owner_user_id =====
ALTER TABLE public.spl_items ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.wrt_items ADD COLUMN IF NOT EXISTS owner_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_spl_items_owner ON public.spl_items(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_wrt_items_owner ON public.wrt_items(owner_user_id);

CREATE OR REPLACE FUNCTION public.spl_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'')
     AND COALESCE(NEW.eng,'') = COALESCE(OLD.eng,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.pic,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.eng,'')), ''))
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.wrt_auto_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL
     AND COALESCE(NEW.pic,'') = COALESCE(OLD.pic,'')
     AND COALESCE(NEW.eng,'') = COALESCE(OLD.eng,'') THEN
    RETURN NEW;
  END IF;
  NEW.owner_user_id := COALESCE(
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.pic,'')), '')),
    public.resolve_user_by_name(NULLIF(btrim(COALESCE(NEW.eng,'')), ''))
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_spl_auto_owner_user_id ON public.spl_items;
CREATE TRIGGER trg_spl_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.spl_items
FOR EACH ROW EXECUTE FUNCTION public.spl_auto_owner_user_id();

DROP TRIGGER IF EXISTS trg_wrt_auto_owner_user_id ON public.wrt_items;
CREATE TRIGGER trg_wrt_auto_owner_user_id BEFORE INSERT OR UPDATE ON public.wrt_items
FOR EACH ROW EXECUTE FUNCTION public.wrt_auto_owner_user_id();

UPDATE public.spl_items SET owner_user_id = COALESCE(
  public.resolve_user_by_name(NULLIF(btrim(COALESCE(pic,'')), '')),
  public.resolve_user_by_name(NULLIF(btrim(COALESCE(eng,'')), '')))
WHERE owner_user_id IS NULL;
UPDATE public.wrt_items SET owner_user_id = COALESCE(
  public.resolve_user_by_name(NULLIF(btrim(COALESCE(pic,'')), '')),
  public.resolve_user_by_name(NULLIF(btrim(COALESCE(eng,'')), '')))
WHERE owner_user_id IS NULL;

-- ===== 3) 전파 로그 =====
CREATE TABLE IF NOT EXISTS public.hdec_name_propagation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,               -- 'profile' | 'master'
  ref_id uuid,
  from_name text,
  to_name text,
  target_table text NOT NULL,
  target_column text NOT NULL,
  owned_rows integer NOT NULL DEFAULT 0,
  unowned_rows integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hdec_name_propagation_log TO authenticated;
GRANT ALL ON public.hdec_name_propagation_log TO service_role;
ALTER TABLE public.hdec_name_propagation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read propagation log" ON public.hdec_name_propagation_log;
CREATE POLICY "admins read propagation log" ON public.hdec_name_propagation_log
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]));

-- ===== 4) profiles → 5개 모듈 전파 (owner 기준 + 미배정 name_norm 기준) =====
CREATE OR REPLACE FUNCTION public.profiles_propagate_to_raw()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_old text; v_new text; v_oldn text;
  v_amb boolean;
  n_owned int; n_unowned int;
BEGIN
  v_old := NULLIF(btrim(COALESCE(OLD.name,'')), '');
  v_new := NULLIF(btrim(COALESCE(NEW.name,'')), '');
  IF v_new IS NULL OR v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  v_oldn := public.hdec_name_norm(v_old);

  -- 옛 이름이 다른 계정에도 남아 있으면(동명이인) 미배정 행은 건드리지 않는다.
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id <> NEW.id AND name_norm = v_oldn) INTO v_amb;

  -- TM
  FOR n_owned IN SELECT 1 LOOP EXIT; END LOOP;

  -- helper inline per table/column
  -- task_management_raw.hdec_pic_name
  WITH o AS (UPDATE public.task_management_raw SET hdec_pic_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.task_management_raw SET hdec_pic_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'task_management_raw', 'hdec_pic_name', n_owned, n_unowned);
  END IF;

  WITH o AS (UPDATE public.task_management_raw SET hdec_eng_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.task_management_raw SET hdec_eng_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'task_management_raw', 'hdec_eng_name', n_owned, n_unowned);
  END IF;

  -- ABD
  WITH o AS (UPDATE public.abd_items_raw SET hdec_pic_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.abd_items_raw SET hdec_pic_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'abd_items_raw', 'hdec_pic_name', n_owned, n_unowned);
  END IF;

  WITH o AS (UPDATE public.abd_items_raw SET hdec_eng_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.abd_items_raw SET hdec_eng_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'abd_items_raw', 'hdec_eng_name', n_owned, n_unowned);
  END IF;

  -- SM
  WITH o AS (UPDATE public.defect_items_raw SET hdec_pic_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.defect_items_raw SET hdec_pic_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_pic_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'defect_items_raw', 'hdec_pic_name', n_owned, n_unowned);
  END IF;

  WITH o AS (UPDATE public.defect_items_raw SET hdec_eng_name = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1),
       u AS (UPDATE public.defect_items_raw SET hdec_eng_name = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(hdec_eng_name) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'defect_items_raw', 'hdec_eng_name', n_owned, n_unowned);
  END IF;

  -- SPL
  WITH o AS (UPDATE public.spl_items SET pic = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(pic) = v_oldn RETURNING 1),
       u AS (UPDATE public.spl_items SET pic = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(pic) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'spl_items', 'pic', n_owned, n_unowned);
  END IF;

  WITH o AS (UPDATE public.spl_items SET eng = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(eng) = v_oldn RETURNING 1),
       u AS (UPDATE public.spl_items SET eng = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(eng) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'spl_items', 'eng', n_owned, n_unowned);
  END IF;

  -- WRT
  WITH o AS (UPDATE public.wrt_items SET pic = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(pic) = v_oldn RETURNING 1),
       u AS (UPDATE public.wrt_items SET pic = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(pic) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'wrt_items', 'pic', n_owned, n_unowned);
  END IF;

  WITH o AS (UPDATE public.wrt_items SET eng = v_new
             WHERE owner_user_id = NEW.id AND public.hdec_name_norm(eng) = v_oldn RETURNING 1),
       u AS (UPDATE public.wrt_items SET eng = v_new
             WHERE NOT v_amb AND owner_user_id IS DISTINCT FROM NEW.id
               AND public.hdec_name_norm(eng) = v_oldn RETURNING 1)
  SELECT (SELECT count(*) FROM o), (SELECT count(*) FROM u) INTO n_owned, n_unowned;
  IF n_owned + n_unowned > 0 THEN
    INSERT INTO public.hdec_name_propagation_log(source, ref_id, from_name, to_name, target_table, target_column, owned_rows, unowned_rows)
    VALUES ('profile', NEW.id, v_old, v_new, 'wrt_items', 'eng', n_owned, n_unowned);
  END IF;

  RETURN NEW;
END $$;
