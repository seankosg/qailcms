-- ABD OCS 정규 증분 Import — 동일 패키지 재실행 차단 (Stage 6)
-- 과거(초기 적재) 로그에는 동일 해시 2건이 존재하므로 신규 기록에만 적용한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_abd_ocs_import_logs_package_hash
  ON public.abd_ocs_import_logs (data_file_hash)
  WHERE data_file_hash IS NOT NULL
    AND started_at >= TIMESTAMPTZ '2026-08-06 00:00:00+03';