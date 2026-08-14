CREATE OR REPLACE FUNCTION public.thread_rows_as_of(
  _module text, _item_id uuid, _as_of date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_as_of date := coalesce(_as_of, (now() AT TIME ZONE 'Asia/Qatar')::date);
  v_uid uuid := auth.uid();
  v_cut timestamptz := ((v_as_of + 1)::timestamp AT TIME ZONE 'Asia/Qatar');
  v_msgs jsonb; v_counts jsonb; v_open int; v_total int; v_last jsonb; v_watched boolean;
BEGIN
  WITH th AS (
    SELECT * FROM public.module_threads t
    WHERE t.module = _module AND t.item_id = _item_id
      AND (public.thread_is_admin(v_uid) OR public.thread_can_see(t.id))
  ), m AS (
    SELECT msg.*, th.stage_code
    FROM public.module_thread_messages msg JOIN th ON th.id = msg.thread_id
    WHERE msg.created_at < v_cut
  ), lastresp AS (
    SELECT DISTINCT ON (r.reply_to_id) r.reply_to_id, r.compliance, r.created_at
    FROM m r WHERE r.kind = 'response' AND r.reply_to_id IS NOT NULL
    ORDER BY r.reply_to_id, r.created_at DESC
  ), enriched AS (
    SELECT m.*,
      CASE WHEN m.kind <> 'instruction' THEN NULL
           ELSE coalesce(lr.compliance, 'pending') END AS derived_status,
      CASE WHEN m.kind <> 'instruction' THEN NULL
           ELSE GREATEST(0, (coalesce((lr.created_at AT TIME ZONE 'Asia/Qatar')::date, v_as_of)
                             - (m.created_at AT TIME ZONE 'Asia/Qatar')::date)) END AS derived_age_days
    FROM m LEFT JOIN lastresp lr ON lr.reply_to_id = m.id
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at), '[]'::jsonb),
    count(*)::int,
    count(*) FILTER (WHERE e.kind='instruction' AND e.derived_status='pending')::int
  INTO v_msgs, v_total, v_open
  FROM enriched e;

  SELECT coalesce(jsonb_object_agg(x.stage_code, jsonb_build_object('total', x.total, 'open_instructions', x.open)), '{}'::jsonb)
  INTO v_counts
  FROM (
    SELECT (e->>'stage_code') AS stage_code,
           count(*)::int AS total,
           count(*) FILTER (WHERE e->>'kind'='instruction' AND e->>'derived_status'='pending')::int AS open
    FROM jsonb_array_elements(v_msgs) e GROUP BY 1
  ) x;

  SELECT e INTO v_last FROM jsonb_array_elements(v_msgs) e
  WHERE e->>'kind'='decision' ORDER BY (e->>'created_at') DESC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.module_thread_watchers w
    JOIN public.module_threads t ON t.id = w.thread_id
    WHERE t.module=_module AND t.item_id=_item_id AND w.user_id=v_uid
  ) INTO v_watched;

  RETURN jsonb_build_object(
    'as_of', v_as_of, 'messages', v_msgs, 'stage_counts', v_counts,
    'total', coalesce(v_total,0), 'open_instructions', coalesce(v_open,0),
    'latest_decision', v_last, 'watched', coalesce(v_watched,false)
  );
END $$;