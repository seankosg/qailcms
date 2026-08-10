CREATE OR REPLACE FUNCTION public.abd_ocs_recount_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_fixed int; v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.abd_ocs_can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'abd_ocs_recount_all: OCS 관리 권한이 필요합니다 (admin 또는 HDEC PIC-DESN)';
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
END $function$;