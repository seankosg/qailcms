-- ── 1. 표 셋 ────────────────────────────────────────────────
CREATE TABLE public.module_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  item_id uuid NOT NULL,
  stage_code text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module, item_id, stage_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_threads TO authenticated;
GRANT ALL ON public.module_threads TO service_role;
ALTER TABLE public.module_threads ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.module_thread_watchers (
  thread_id uuid NOT NULL REFERENCES public.module_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_thread_watchers TO authenticated;
GRANT ALL ON public.module_thread_watchers TO service_role;
ALTER TABLE public.module_thread_watchers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.module_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.module_threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('report','question','instruction','decision','response')),
  body text NOT NULL,
  author_user_id uuid NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('PIC','ENG','ADMIN')),
  to_user_id uuid,
  reply_to_id uuid REFERENCES public.module_thread_messages(id) ON DELETE RESTRICT,
  compliance text CHECK (compliance IN ('yes','no','wip')),
  reason_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mtm_response_shape CHECK (
    kind <> 'response' OR (reply_to_id IS NOT NULL AND compliance IS NOT NULL)
  ),
  CONSTRAINT mtm_reason_required CHECK (
    compliance IS NULL OR compliance = 'yes' OR btrim(coalesce(reason_text,'')) <> ''
  ),
  CONSTRAINT mtm_instruction_to CHECK (kind <> 'instruction' OR to_user_id IS NOT NULL),
  CONSTRAINT mtm_non_response_null CHECK (
    kind = 'response' OR (compliance IS NULL AND reply_to_id IS NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_thread_messages TO authenticated;
GRANT ALL ON public.module_thread_messages TO service_role;
ALTER TABLE public.module_thread_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mtm_thread ON public.module_thread_messages(thread_id, created_at);
CREATE INDEX idx_mt_item ON public.module_threads(module, item_id);

-- ── 2. 기본 담당자 뽑기 (단일 지점) ─────────────────────────
-- module_stage_assignees 가 생기면 이 함수만 고친다. NULL 은 정상값이다.
CREATE OR REPLACE FUNCTION public.thread_assignee_of(
  _module text, _item_id uuid, _stage_code text, _role text
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_band text; v_name text;
BEGIN
  IF upper(coalesce(_module,'')) <> 'SPL' THEN RETURN NULL; END IF;
  SELECT band INTO v_band FROM public.spl_stage_catalog WHERE stage_code = _stage_code LIMIT 1;
  IF v_band = 'PO' THEN
    SELECT CASE WHEN _role = 'pic' THEN pic_po ELSE eng_po END INTO v_name
      FROM public.spl_items WHERE id = _item_id;
  ELSE
    SELECT CASE WHEN _role = 'pic' THEN pic ELSE eng END INTO v_name
      FROM public.spl_items WHERE id = _item_id;
  END IF;
  RETURN public.resolve_user_by_name(NULLIF(btrim(coalesce(v_name,'')), ''));
END $$;

CREATE OR REPLACE FUNCTION public.thread_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'system_administrator')
$$;

CREATE OR REPLACE FUNCTION public.thread_can_see(_thread_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  IF public.thread_is_admin(uid) THEN RETURN true; END IF;
  SELECT * INTO t FROM public.module_threads WHERE id = _thread_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF uid IN (
      coalesce(public.thread_assignee_of(t.module,t.item_id,t.stage_code,'pic'),'00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(public.thread_assignee_of(t.module,t.item_id,t.stage_code,'eng'),'00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(t.created_by,'00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.module_thread_watchers w WHERE w.thread_id=_thread_id AND w.user_id=uid)
  THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.module_thread_messages m
    WHERE m.thread_id=_thread_id AND (m.author_user_id=uid OR m.to_user_id=uid)
  );
END $$;

-- ── RLS ────────────────────────────────────────────────────
CREATE POLICY mt_read ON public.module_threads FOR SELECT TO authenticated
  USING (public.thread_can_see(id));
CREATE POLICY mt_admin_write ON public.module_threads FOR ALL TO authenticated
  USING (public.thread_is_admin(auth.uid())) WITH CHECK (public.thread_is_admin(auth.uid()));

CREATE POLICY mtw_read ON public.module_thread_watchers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.thread_is_admin(auth.uid()));
CREATE POLICY mtw_write ON public.module_thread_watchers FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.thread_can_see(thread_id));

CREATE POLICY mtm_read ON public.module_thread_messages FOR SELECT TO authenticated
  USING (public.thread_can_see(thread_id));
CREATE POLICY mtm_admin_write ON public.module_thread_messages FOR ALL TO authenticated
  USING (public.thread_is_admin(auth.uid())) WITH CHECK (public.thread_is_admin(auth.uid()));

-- ── 3. 파생 조회 (상태 컬럼 없음) ───────────────────────────
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
  CREATE TEMP TABLE IF NOT EXISTS _t_noop() ON COMMIT DROP;
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

-- ── 4. 쓰기 RPC 둘 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.thread_ensure(
  _module text, _item_id uuid, _stage_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.module_threads
   WHERE module=_module AND item_id=_item_id AND stage_code=_stage_code;
  IF v_id IS NULL THEN
    INSERT INTO public.module_threads(module,item_id,stage_code,created_by)
    VALUES (_module,_item_id,_stage_code,auth.uid())
    ON CONFLICT (module,item_id,stage_code) DO UPDATE SET module=EXCLUDED.module
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.thread_post_message(
  _module text, _item_id uuid, _stage_code text, _kind text, _body text,
  _to_user_id uuid DEFAULT NULL, _reply_to_id uuid DEFAULT NULL,
  _compliance text DEFAULT NULL, _reason_text text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_pic uuid; v_eng uuid; v_role text; v_thread uuid; v_id uuid; v_target uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF btrim(coalesce(_body,'')) = '' THEN RAISE EXCEPTION '내용을 입력하십시오'; END IF;

  v_pic := public.thread_assignee_of(_module,_item_id,_stage_code,'pic');
  v_eng := public.thread_assignee_of(_module,_item_id,_stage_code,'eng');
  v_role := CASE WHEN uid = v_pic THEN 'PIC'
                 WHEN uid = v_eng THEN 'ENG'
                 WHEN public.thread_is_admin(uid) THEN 'ADMIN' END;
  IF v_role IS NULL THEN RAISE EXCEPTION '이 단계의 담당자만 작성할 수 있습니다'; END IF;

  IF _kind IN ('instruction','decision') AND v_role = 'ENG' THEN
    RAISE EXCEPTION '지시는 이 단계의 PIC 만 작성할 수 있습니다';
  END IF;

  IF _kind = 'instruction' THEN
    IF _to_user_id IS NULL THEN RAISE EXCEPTION '받는 사람을 고르십시오'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_to_user_id AND coalesce(p.is_active,true))
      THEN RAISE EXCEPTION '받는 사람이 활성 계정이 아닙니다'; END IF;
  END IF;

  IF _kind = 'response' THEN
    IF _reply_to_id IS NULL OR _compliance IS NULL THEN
      RAISE EXCEPTION '응답은 대상 지시와 이행 여부가 필요합니다'; END IF;
    SELECT to_user_id INTO v_target FROM public.module_thread_messages
      WHERE id=_reply_to_id AND kind='instruction';
    IF v_target IS NULL THEN RAISE EXCEPTION '대상 지시를 찾을 수 없습니다'; END IF;
    IF uid <> v_target AND NOT public.thread_is_admin(uid) THEN
      RAISE EXCEPTION '지시를 받은 사람만 응답할 수 있습니다'; END IF;
    IF _compliance IN ('no','wip') AND btrim(coalesce(_reason_text,'')) = '' THEN
      RAISE EXCEPTION '사유를 입력하십시오'; END IF;
  END IF;

  v_thread := public.thread_ensure(_module,_item_id,_stage_code);
  INSERT INTO public.module_thread_messages(
    thread_id,kind,body,author_user_id,author_role,to_user_id,reply_to_id,compliance,reason_text)
  VALUES (v_thread,_kind,_body,uid,v_role,
          CASE WHEN _kind='instruction' THEN _to_user_id END,
          CASE WHEN _kind='response' THEN _reply_to_id END,
          CASE WHEN _kind='response' THEN _compliance END,
          CASE WHEN _kind='response' THEN _reason_text END)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'thread_id', v_thread, 'author_role', v_role);
END $$;

CREATE OR REPLACE FUNCTION public.thread_set_watch(
  _module text, _item_id uuid, _stage_code text, _on boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_thread uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF _on THEN
    v_thread := public.thread_ensure(_module,_item_id,_stage_code);
    INSERT INTO public.module_thread_watchers(thread_id,user_id)
    VALUES (v_thread,uid) ON CONFLICT DO NOTHING;
  ELSE
    SELECT id INTO v_thread FROM public.module_threads
      WHERE module=_module AND item_id=_item_id AND stage_code=_stage_code;
    IF v_thread IS NOT NULL THEN
      DELETE FROM public.module_thread_watchers WHERE thread_id=v_thread AND user_id=uid;
    END IF;
  END IF;
  RETURN jsonb_build_object('watched', coalesce(_on,false), 'thread_id', v_thread);
END $$;

GRANT EXECUTE ON FUNCTION public.thread_assignee_of(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.thread_rows_as_of(text,uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.thread_post_message(text,uuid,text,text,text,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.thread_set_watch(text,uuid,text,boolean) TO authenticated;