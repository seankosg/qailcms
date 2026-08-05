-- 기록 누락 보정: SPL owner_cols 4컬럼 확장은 마이그레이션 밖에서 적용되어 있었다.
-- 멱등 UPDATE 로 정본을 고정한다. (되돌리기: .lovable/reverts/20260805_spl_owner_cols_revert.sql)
UPDATE public.rcl_module_config
   SET owner_cols = ARRAY['pic','eng','pic_po','eng_po']::text[],
       updated_at = now()
 WHERE module = 'SPL'
   AND owner_cols IS DISTINCT FROM ARRAY['pic','eng','pic_po','eng_po']::text[];