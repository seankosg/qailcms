-- 되돌리기: SPL owner_cols 를 시드 값(ARRAY['pic','eng'])으로 복원
-- 대상 마이그레이션: rcl_module_config SPL owner_cols 멱등 고정 (2026-08-05)
-- 적용하지 않음. 필요 시 지시자 승인 후 수동 실행.
UPDATE public.rcl_module_config
   SET owner_cols = ARRAY['pic','eng']::text[]
 WHERE module = 'SPL'
   AND owner_cols = ARRAY['pic','eng','pic_po','eng_po']::text[];
