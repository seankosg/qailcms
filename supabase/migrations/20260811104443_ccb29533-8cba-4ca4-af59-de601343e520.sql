CREATE OR REPLACE FUNCTION public.get_module_backup_tables(_module text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(t.table_name ORDER BY t.table_name), ARRAY[]::text[])
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND (
      (lower(_module) = 'abd' AND t.table_name LIKE 'abd\_ocs\_%')
      OR (lower(_module) = 'spl' AND (
            t.table_name LIKE 'spl\_ocs\_%'
         OR t.table_name LIKE 'spl\_rsp\_%'
         OR t.table_name LIKE 'spl\_document%'
      ))
    )
    -- staging / 임시 / 검증 영수증 / 스냅샷 백업 테이블은 백업 정본 대상이 아니다
    AND t.table_name !~ '_v[0-9]+_stage'
    AND t.table_name !~ '_stage$'
    AND t.table_name !~ 'verify_receipt'
    AND t.table_name !~ 'snapshot'
    AND t.table_name !~ 'backup'
    AND t.table_name !~ 'preserve'
    AND t.table_name !~ '_20[0-9]{6}$'
$function$;

GRANT EXECUTE ON FUNCTION public.get_module_backup_tables(text) TO authenticated, service_role;