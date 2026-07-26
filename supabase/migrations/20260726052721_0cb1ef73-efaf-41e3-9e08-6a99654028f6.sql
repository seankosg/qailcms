-- T1: ABD 레거시 drafting_* 잔재 정리
-- 컬럼은 20260725164217에서 이미 제거되었으나 field_config/header_mappings에 참조가 남아있음.
DELETE FROM public.abd_header_mappings WHERE target_field LIKE 'r%_drafting_%';
DELETE FROM public.abd_field_config WHERE field_key LIKE 'r%_drafting_%';