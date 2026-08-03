-- 정규화 함수
CREATE OR REPLACE FUNCTION public.hdec_name_norm(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(regexp_replace(coalesce(_name,''), '\s+', ' ', 'g')))
$$;

-- ENG 명부
ALTER TABLE public.hdec_eng_name_master
  ADD COLUMN IF NOT EXISTS name_norm text,
  ADD COLUMN IF NOT EXISTS name_variants text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_user_id uuid,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid;

-- PIC 명부
ALTER TABLE public.hdec_pic_name_master
  ADD COLUMN IF NOT EXISTS name_norm text,
  ADD COLUMN IF NOT EXISTS name_variants text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_user_id uuid,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid;

UPDATE public.hdec_eng_name_master SET name_norm = public.hdec_name_norm(name) WHERE name_norm IS DISTINCT FROM public.hdec_name_norm(name);
UPDATE public.hdec_pic_name_master SET name_norm = public.hdec_name_norm(name) WHERE name_norm IS DISTINCT FROM public.hdec_name_norm(name);

ALTER TABLE public.hdec_eng_name_master ALTER COLUMN name_norm SET NOT NULL;
ALTER TABLE public.hdec_pic_name_master ALTER COLUMN name_norm SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hdec_eng_name_master_name_norm_key ON public.hdec_eng_name_master(name_norm);
CREATE UNIQUE INDEX IF NOT EXISTS hdec_pic_name_master_name_norm_key ON public.hdec_pic_name_master(name_norm);

ALTER TABLE public.hdec_eng_name_master
  ADD CONSTRAINT hdec_eng_name_master_merged_into_fk FOREIGN KEY (merged_into_id) REFERENCES public.hdec_eng_name_master(id) ON DELETE SET NULL;
ALTER TABLE public.hdec_pic_name_master
  ADD CONSTRAINT hdec_pic_name_master_merged_into_fk FOREIGN KEY (merged_into_id) REFERENCES public.hdec_pic_name_master(id) ON DELETE SET NULL;

-- name 변경 시 name_norm 자동 재계산
CREATE OR REPLACE FUNCTION public.hdec_master_sync_norm()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.name_norm := public.hdec_name_norm(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hdec_eng_master_norm ON public.hdec_eng_name_master;
CREATE TRIGGER trg_hdec_eng_master_norm BEFORE INSERT OR UPDATE OF name ON public.hdec_eng_name_master
FOR EACH ROW EXECUTE FUNCTION public.hdec_master_sync_norm();

DROP TRIGGER IF EXISTS trg_hdec_pic_master_norm ON public.hdec_pic_name_master;
CREATE TRIGGER trg_hdec_pic_master_norm BEFORE INSERT OR UPDATE OF name ON public.hdec_pic_name_master
FOR EACH ROW EXECUTE FUNCTION public.hdec_master_sync_norm();