SET search_path = public, extensions;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.tm_pic_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_raw_id uuid NOT NULL REFERENCES public.task_management_raw(id) ON DELETE CASCADE,
  from_pic text NOT NULL,
  to_pic text NOT NULL,
  from_pic_norm text,
  to_pic_norm text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tm_pic_deleg_status_chk CHECK (status IN ('active','cancelled')),
  CONSTRAINT tm_pic_deleg_range_chk CHECK (start_date <= end_date),
  CONSTRAINT tm_pic_deleg_min_chk CHECK (start_date >= DATE '2020-01-01' AND end_date <= DATE '2035-12-31'),
  CONSTRAINT tm_pic_deleg_no_overlap EXCLUDE USING gist (
    task_raw_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active')
);

CREATE INDEX tm_pic_deleg_task_idx ON public.tm_pic_delegations (task_raw_id, status, start_date, end_date);
CREATE INDEX tm_pic_deleg_to_idx ON public.tm_pic_delegations (to_pic_norm, status, start_date, end_date);
CREATE INDEX tm_pic_deleg_from_idx ON public.tm_pic_delegations (from_pic_norm, status, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tm_pic_delegations TO authenticated;
GRANT ALL ON public.tm_pic_delegations TO service_role;

ALTER TABLE public.tm_pic_delegations ENABLE ROW LEVEL SECURITY;

-- 정규화 + 자기위임/체인 금지 트리거
CREATE OR REPLACE FUNCTION public.tm_pic_deleg_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.from_pic := btrim(NEW.from_pic);
  NEW.to_pic := btrim(NEW.to_pic);
  NEW.from_pic_norm := public.hdec_name_norm(NEW.from_pic);
  NEW.to_pic_norm := public.hdec_name_norm(NEW.to_pic);
  NEW.updated_at := now();

  IF NEW.from_pic_norm IS NULL OR NEW.from_pic_norm = '' OR NEW.to_pic_norm IS NULL OR NEW.to_pic_norm = '' THEN
    RAISE EXCEPTION '위임 담당자 이름이 비어 있습니다 (from=%, to=%)', NEW.from_pic, NEW.to_pic;
  END IF;

  IF NEW.from_pic_norm = NEW.to_pic_norm THEN
    RAISE EXCEPTION '자기 자신에게는 위임할 수 없습니다 (%).', NEW.to_pic;
  END IF;

  IF public.resolve_user_by_name(NEW.to_pic) IS NULL THEN
    RAISE EXCEPTION '인수자 이름을 사용자 계정으로 특정할 수 없습니다: %', NEW.to_pic;
  END IF;

  IF NEW.status = 'active' THEN
    -- 위임의 위임(체인) 금지: 같은 태스크에서 기간이 겹치는 다른 활성 위임과 연결되면 에러
    IF EXISTS (
      SELECT 1 FROM public.tm_pic_delegations d
      WHERE d.task_raw_id = NEW.task_raw_id
        AND d.id IS DISTINCT FROM NEW.id
        AND d.status = 'active'
        AND daterange(d.start_date, d.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
        AND (d.to_pic_norm = NEW.from_pic_norm OR d.from_pic_norm = NEW.to_pic_norm)
    ) THEN
      RAISE EXCEPTION '위임의 위임(체인)은 허용되지 않습니다. 기존 위임을 먼저 종료하세요.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER tm_pic_deleg_guard_trg
BEFORE INSERT OR UPDATE ON public.tm_pic_delegations
FOR EACH ROW EXECUTE FUNCTION public.tm_pic_deleg_guard();

-- 유효 PIC 판정 (원본은 그대로, 날짜 비교로만 파생)
CREATE OR REPLACE FUNCTION public.tm_effective_pic(_task_raw_id uuid, _as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Qatar')::date))
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT d.to_pic
       FROM public.tm_pic_delegations d
      WHERE d.task_raw_id = _task_raw_id
        AND d.status = 'active'
        AND _as_of BETWEEN d.start_date AND d.end_date
      ORDER BY d.created_at DESC
      LIMIT 1),
    (SELECT r.hdec_pic_name FROM public.task_management_raw r WHERE r.id = _task_raw_id)
  );
$$;

-- 특정 계정이 그 시점 인수자인가
CREATE OR REPLACE FUNCTION public.tm_is_delegate(_user_id uuid, _task_raw_id uuid, _as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Qatar')::date))
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tm_pic_delegations d
      JOIN public.profiles p ON p.name_norm = d.to_pic_norm
     WHERE d.task_raw_id = _task_raw_id
       AND d.status = 'active'
       AND _as_of BETWEEN d.start_date AND d.end_date
       AND p.id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.tm_effective_pic(uuid, date) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.tm_is_delegate(uuid, uuid, date) TO authenticated, service_role;

-- 위임 표 자체의 접근 규칙
CREATE POLICY tm_pic_deleg_select ON public.tm_pic_delegations
FOR SELECT TO authenticated USING (true);

CREATE POLICY tm_pic_deleg_insert ON public.tm_pic_delegations
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = public.hdec_name_norm(from_pic))
);

CREATE POLICY tm_pic_deleg_update ON public.tm_pic_delegations
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = from_pic_norm)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.name_norm = public.hdec_name_norm(from_pic))
);

CREATE POLICY tm_pic_deleg_delete ON public.tm_pic_delegations
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- TM 편집 권한에 위임 갈래 추가 (격자 정본은 건드리지 않음)
DROP POLICY IF EXISTS tmr_update ON public.task_management_raw;
CREATE POLICY tmr_update ON public.task_management_raw
FOR UPDATE
USING (
  rcl_can(auth.uid(), 'TM'::text, id, 'write'::text)
  OR public.tm_is_delegate(auth.uid(), id)
)
WITH CHECK (
  rcl_can_values('TM'::text, jsonb_build_object('team', team, 'hdec_pic_name', hdec_pic_name, 'hdec_eng_name', hdec_eng_name), 'write'::text)
  OR public.tm_is_delegate(auth.uid(), id)
);

DROP POLICY IF EXISTS tmsh_insert ON public.task_management_status_history;
CREATE POLICY tmsh_insert ON public.task_management_status_history
FOR INSERT
WITH CHECK (
  rcl_can(auth.uid(), 'TM'::text, task_raw_id, 'write'::text)
  OR public.tm_is_delegate(auth.uid(), task_raw_id)
);
