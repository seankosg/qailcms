-- 1) 캐시 컬럼 (정본 = abd_ocs_comments + abd_ocs_compliance)
ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS ocs_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocs_complied integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ocs_check text NOT NULL DEFAULT 'none';

ALTER TABLE public.abd_items_raw
  ADD CONSTRAINT abd_items_raw_ocs_total_chk CHECK (ocs_total >= 0),
  ADD CONSTRAINT abd_items_raw_ocs_complied_chk CHECK (ocs_complied >= 0 AND ocs_complied <= ocs_total),
  ADD CONSTRAINT abd_items_raw_ocs_check_chk CHECK (ocs_check IN ('none','pending','ok'));

COMMENT ON COLUMN public.abd_items_raw.ocs_total IS 'OCS 캐시(성능용). 정본 = abd_ocs_comments(active, linked). 사용자/임포트가 절대 쓰지 않음.';
COMMENT ON COLUMN public.abd_items_raw.ocs_complied IS 'OCS 캐시(성능용). 정본 = abd_ocs_compliance.complied.';
COMMENT ON COLUMN public.abd_items_raw.ocs_check IS 'OCS 캐시 파생: none(total=0) / ok(complied=total) / pending. 정렬 표준 순서 = pending > ok > none.';

-- 2) 단일 행 재계산 (내부 트리거/서비스 전용)
CREATE OR REPLACE FUNCTION public.abd_ocs_recount_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total int := 0; v_complied int := 0; v_check text;
BEGIN
  IF p_item_id IS NULL THEN RETURN; END IF;
  SELECT count(*)::int, count(*) FILTER (WHERE coalesce(cp.complied,false))::int
    INTO v_total, v_complied
    FROM public.abd_ocs_comments c
    LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = c.id
   WHERE c.abd_item_id = p_item_id
     AND c.is_active = true
     AND c.link_status = 'linked';
  v_check := CASE WHEN v_total = 0 THEN 'none'
                  WHEN v_complied >= v_total THEN 'ok'
                  ELSE 'pending' END;
  UPDATE public.abd_items_raw
     SET ocs_total = v_total, ocs_complied = v_complied, ocs_check = v_check
   WHERE id = p_item_id
     AND (ocs_total IS DISTINCT FROM v_total
       OR ocs_complied IS DISTINCT FROM v_complied
       OR ocs_check IS DISTINCT FROM v_check);
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_recount_item(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abd_ocs_recount_item(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abd_ocs_recount_item(uuid) TO service_role;

-- 3) 트리거
CREATE OR REPLACE FUNCTION public.abd_ocs_comments_recount_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.abd_item_id IS NOT NULL THEN
    PERFORM public.abd_ocs_recount_item(OLD.abd_item_id);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.abd_item_id IS NOT NULL THEN
    PERFORM public.abd_ocs_recount_item(NEW.abd_item_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.abd_ocs_compliance_recount_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_item uuid;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT abd_item_id INTO v_item FROM public.abd_ocs_comments WHERE id = OLD.comment_id;
    PERFORM public.abd_ocs_recount_item(v_item);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT abd_item_id INTO v_item FROM public.abd_ocs_comments WHERE id = NEW.comment_id;
    PERFORM public.abd_ocs_recount_item(v_item);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_abd_ocs_comments_recount_ins ON public.abd_ocs_comments;
CREATE TRIGGER trg_abd_ocs_comments_recount_ins
AFTER INSERT ON public.abd_ocs_comments
FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_comments_recount_tg();

DROP TRIGGER IF EXISTS trg_abd_ocs_comments_recount_upd ON public.abd_ocs_comments;
CREATE TRIGGER trg_abd_ocs_comments_recount_upd
AFTER UPDATE ON public.abd_ocs_comments
FOR EACH ROW
WHEN (OLD.abd_item_id IS DISTINCT FROM NEW.abd_item_id
   OR OLD.is_active IS DISTINCT FROM NEW.is_active
   OR OLD.link_status IS DISTINCT FROM NEW.link_status)
EXECUTE FUNCTION public.abd_ocs_comments_recount_tg();

DROP TRIGGER IF EXISTS trg_abd_ocs_comments_recount_del ON public.abd_ocs_comments;
CREATE TRIGGER trg_abd_ocs_comments_recount_del
AFTER DELETE ON public.abd_ocs_comments
FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_comments_recount_tg();

DROP TRIGGER IF EXISTS trg_abd_ocs_compliance_recount ON public.abd_ocs_compliance;
CREATE TRIGGER trg_abd_ocs_compliance_recount
AFTER INSERT OR UPDATE OR DELETE ON public.abd_ocs_compliance
FOR EACH ROW EXECUTE FUNCTION public.abd_ocs_compliance_recount_tg();

-- 4) 전체 재계산 (관리자 / 서비스 전용)
CREATE OR REPLACE FUNCTION public.abd_ocs_recount_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_fixed int; v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'abd_ocs_recount_all: admin only';
  END IF;

  WITH agg AS (
    SELECT c.abd_item_id AS id,
           count(*)::int AS t,
           count(*) FILTER (WHERE coalesce(cp.complied,false))::int AS d
      FROM public.abd_ocs_comments c
      LEFT JOIN public.abd_ocs_compliance cp ON cp.comment_id = c.id
     WHERE c.is_active = true AND c.link_status = 'linked' AND c.abd_item_id IS NOT NULL
     GROUP BY c.abd_item_id
  ), tgt AS (
    SELECT r.id,
           coalesce(a.t,0) AS t,
           coalesce(a.d,0) AS d,
           CASE WHEN coalesce(a.t,0) = 0 THEN 'none'
                WHEN coalesce(a.d,0) >= coalesce(a.t,0) THEN 'ok'
                ELSE 'pending' END AS chk
      FROM public.abd_items_raw r
      LEFT JOIN agg a ON a.id = r.id
  ), upd AS (
    UPDATE public.abd_items_raw r
       SET ocs_total = tgt.t, ocs_complied = tgt.d, ocs_check = tgt.chk
      FROM tgt
     WHERE r.id = tgt.id
       AND (r.ocs_total IS DISTINCT FROM tgt.t
         OR r.ocs_complied IS DISTINCT FROM tgt.d
         OR r.ocs_check IS DISTINCT FROM tgt.chk)
     RETURNING 1
  )
  SELECT count(*)::int INTO v_fixed FROM upd;

  SELECT jsonb_build_object(
    'recounted', (SELECT count(*) FROM public.abd_items_raw),
    'mismatch_fixed', v_fixed,
    'ok', (SELECT count(*) FROM public.abd_items_raw WHERE ocs_check='ok'),
    'pending', (SELECT count(*) FROM public.abd_items_raw WHERE ocs_check='pending'),
    'none', (SELECT count(*) FROM public.abd_items_raw WHERE ocs_check='none'),
    'linked_comment_total', (SELECT coalesce(sum(ocs_total),0) FROM public.abd_items_raw),
    'cached_complied_total', (SELECT coalesce(sum(ocs_complied),0) FROM public.abd_items_raw)
  ) INTO v_res;
  RETURN v_res;
END $$;

REVOKE ALL ON FUNCTION public.abd_ocs_recount_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abd_ocs_recount_all() FROM anon;
GRANT EXECUTE ON FUNCTION public.abd_ocs_recount_all() TO authenticated, service_role;

-- 5) 초기 backfill (updated_at 오염 방지를 위해 타임스탬프 트리거 일시 정지)
ALTER TABLE public.abd_items_raw DISABLE TRIGGER trg_abd_items_updated_at;
SELECT public.abd_ocs_recount_all();
ALTER TABLE public.abd_items_raw ENABLE TRIGGER trg_abd_items_updated_at;

CREATE INDEX IF NOT EXISTS idx_abd_items_raw_ocs_check ON public.abd_items_raw (ocs_check);