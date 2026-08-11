CREATE OR REPLACE FUNCTION public.tm_pic_deleg_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- 이미 시작한 위임은 취소 불가 (과거 소급 변경 금지). 종료일 단축으로 마무리한다.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND NEW.status = 'cancelled'
     AND NEW.start_date <= (now() AT TIME ZONE 'Asia/Qatar')::date THEN
    RAISE EXCEPTION '이미 시작한 위임은 취소할 수 없습니다. 종료일을 앞당겨 주십시오.';
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
END $function$;