DROP INDEX IF EXISTS public.uq_abd_ocs_import_logs_package_hash;

-- 정규 증분 run 식별: data_file_name 이 패키지 계약 파일명(OCS_Increment_<YYYYMMDD>_<seq>.zip)인 행만.
-- 레거시 run 은 data_file_name 이 *.json 이라 인덱스 대상에서 자연 제외된다(날짜 조건 불필요).
-- status='failed' 는 제외하여 실패한 run 의 재시도를 허용한다.
CREATE UNIQUE INDEX uq_abd_ocs_import_logs_package_hash
  ON public.abd_ocs_import_logs (data_file_hash)
  WHERE data_file_hash IS NOT NULL
    AND status <> 'failed'
    AND data_file_name ~ '^OCS_Increment_[0-9]{8}_[0-9]+\.zip$';