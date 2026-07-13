# Defect Raw Data 전체 삭제 1회 마이그레이션 계획

## 목적
현재 `defect_items_raw`에 저장된 모든 데이터를 초기화. 신규 임포트 파일로 처음부터 DB를 다시 채우기 위함.

## 실행 내용 (1회성 마이그레이션 SQL)

관련 4개 테이블을 함께 비웁니다 (외래키/이력 정합성 유지):

1. `TRUNCATE public.defect_status_history RESTART IDENTITY CASCADE;` — 변경 이력
2. `TRUNCATE public.defect_import_row_logs RESTART IDENTITY CASCADE;` — 임포트 행별 로그
3. `TRUNCATE public.defect_items_raw RESTART IDENTITY CASCADE;` — 결함 원본 데이터 본체
4. `TRUNCATE public.defect_import_logs RESTART IDENTITY CASCADE;` — 임포트 배치 로그

> `TRUNCATE`는 조건 없이 전체 삭제하며, RLS 정책과 무관하게 실행됩니다. `CASCADE`로 참조 관계까지 함께 정리합니다.

## 유지되는 항목 (초기화하지 않음)
- `defect_header_mappings` (엑셀 헤더 매핑 규칙)
- `defect_field_config` (필드 설정)
- `hdec_pic_master`, `subcontractor_master` (마스터 데이터)
- `user_roles`, `profiles` 등 사용자/권한 데이터
- 다른 도메인(spare parts, task management)의 데이터

## 주의사항
- **되돌릴 수 없음.** 삭제 후 이전 데이터는 복구 불가.
- 관련 화면(대시보드, Raw Data, 히스토리 등)은 잠시 빈 상태로 표시되며, 신규 임포트 완료 후 정상 표시됩니다.
- 코드 변경 없음 — 데이터 삭제 마이그레이션만 실행.

승인해주시면 마이그레이션을 등록합니다.
