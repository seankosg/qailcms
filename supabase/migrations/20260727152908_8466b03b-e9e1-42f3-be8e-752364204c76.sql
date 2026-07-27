ALTER TABLE public.abd_import_logs ADD COLUMN IF NOT EXISTS build_id text;
CREATE INDEX IF NOT EXISTS abd_import_logs_build_id_idx ON public.abd_import_logs (build_id);
COMMENT ON COLUMN public.abd_import_logs.build_id IS '임포트 실행 시점의 앱 빌드 식별자 (__APP_BUILD_ID__). 배포 검증 및 스테일 인스턴스 감지에 사용.';