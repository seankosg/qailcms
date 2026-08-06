-- ⛔ 임시 조치(2026-08-06, 원복 예정): admin 외 Milestone 변경 금지.
-- 원복: DROP TRIGGER tm_guard_milestone_admin_only ON public.task_management_raw;
--       DROP FUNCTION public.tm_guard_milestone_admin_only();
CREATE OR REPLACE FUNCTION public.tm_guard_milestone_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF NEW.milestone IS NOT DISTINCT FROM OLD.milestone THEN
    RETURN NEW;
  END IF;
  -- 서버 내부 작업(서비스 롤, 세션 없음)은 자체 코드 경로에서 별도 판정한다.
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '권한 없음: Milestone 은 현재 관리자만 변경할 수 있습니다(임시 조치).';
END;
$$;

DROP TRIGGER IF EXISTS tm_guard_milestone_admin_only ON public.task_management_raw;
CREATE TRIGGER tm_guard_milestone_admin_only
BEFORE UPDATE OF milestone ON public.task_management_raw
FOR EACH ROW EXECUTE FUNCTION public.tm_guard_milestone_admin_only();