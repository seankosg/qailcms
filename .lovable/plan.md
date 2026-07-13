
# ABD Phase 2 구현 계획 — Import 상세 & Detail

Phase 1(스키마, 파서, Raw Data 3탭, 최소 Import)는 완료. 이번 Phase 2는 **Defect 도메인의 Import 로그/롤백/헤더 매핑/필드 설정 화면과 동일한 UX**를 ABD 로 이식하고, Raw Data 행 클릭 시 **Detail 팝오버**를 붙입니다.

## 1. Import Logs 화면
**라우트**: `src/routes/_authenticated/closure/abd/import.logs.tsx`
**컴포넌트**: `src/components/abd/import/AbdImportLogsPage.tsx`

- Defect `DefectImportLogsPage.tsx` 를 1:1 이식. 컬럼만 ABD 스키마(`team, plot, sheet_name, total_rows, inserted/updated/inactivated/mismatched/skipped_no_key, status, imported_by, started_at/finished_at, rolled_back_at`)로 교체.
- 필터: team(mech/elec/arch), status(running/success/failed/rolled_back), 기간, 업로더.
- 행 액션:
  - **View Detail** → 우측 Sheet 로 `abd_import_row_logs`(신규, 아래) + `errors jsonb` 표시.
  - **Rollback** → Defect `RollbackDialog` 재사용. `preview_rollback_abd_import` 로 영향 행수 미리보기 후 `rollback_abd_import` 실행.
  - **Delete Batch** → `delete_abd_import_batch` (soft: 로그만 삭제, raw 데이터는 유지). Admin only.
- 상단 요약 카드: 최근 7일 임포트 건수, 성공률, 총 upsert 행수.

## 2. Import Row Logs 테이블 (신규 마이그레이션)
Defect 의 `defect_import_row_logs` 대응. 파일 내 각 행의 처리 결과를 저장하여 롤백/디버그를 지원.

- `public.abd_import_row_logs`
  - `id, import_log_id (FK), row_index int, abd_number text, action ('insert'|'update'|'inactivate'|'skip'|'error'), before jsonb, after jsonb, error_message text, created_at`
  - RLS: authenticated read, service_role write. GRANT 4행.
- `AbdImportPage` 의 서버 함수에서 각 행 처리 시 이 테이블에 batch insert.

## 3. Rollback / Delete RPC 실장 강화
Phase 1 에서 시그니처만 만든 3개 RPC 를 실제 로직으로 채움 (Defect 미러).
- `rollback_abd_import(_batch_id, _force)`:
  - 해당 배치가 만든 INSERT 행 삭제, UPDATE 행은 `abd_change_log` 의 `old_value` 로 복원, INACTIVATE 처리는 `is_active=true` 로 되돌림.
  - `abd_import_logs.status='rolled_back'`, `rolled_back_at/by` 기록.
  - `_force=false` 이고 이후 다른 배치가 같은 `abd_number` 를 건드렸으면 실패.
- `preview_rollback_abd_import(_batch_id)`: 영향 행 카운트 반환.
- `delete_abd_import_batch(_batch_id)`: 로그 + row_logs 만 삭제.

## 4. 헤더 매핑 / 필드 설정 관리 화면
**라우트**: `src/routes/_authenticated/closure/abd/settings.tsx` (Admin only)
**컴포넌트**: `src/components/abd/settings/AbdSettingsPage.tsx`

Defect 의 `HeaderMappingsManager` / `FieldConfigManager` 를 이식.
- **Header Mappings 탭**: 엑셀 원본 헤더 문자열 ↔ 정규 필드명 별칭 관리. 파서가 시트에서 헤더 감지 실패 시 이 표를 fallback 으로 사용.
- **Field Config 탭**: 컬럼별 라벨/표시여부/편집가능/필터 타입(text/select/date/num)/기본 정렬을 관리. Raw Data 페이지가 이 설정을 읽어 렌더링에 반영.
- 두 화면 모두 인라인 편집 + 저장 버튼, 기본값 리셋 기능.

## 5. Raw Data → Detail 팝오버
`src/components/abd/raw-data/AbdDetailSheet.tsx` — 우측 Sheet.

- 상단: `abd_number`, `document_title`, `plot`, `team`, `pic`, `latest_rev`, `latest_status`.
- 섹션:
  1. **Rounds 타임라인** — R1/R2/R3 의 Drafting → Submission → DAR 를 Plan vs Actual 로 시각화 (Plan 회색선, Actual 컬러 점, 지연 시 빨강).
  2. **Change Log** — `abd_change_log` 최근 20건 (필드/이전값/새값/출처/시각/유저).
  3. **Raw Payload** — 접히는 JSON 뷰어 (`raw_payload`).
  4. **Field Mismatch** — `field_mismatch=true` 인 경우 어떤 필드가 다른지 표.
- 편집 가능한 필드는 즉시 편집 (Raw Data 셀 편집과 동일 훅 재사용).
- 라우팅: `?detail={id}` 쿼리로 딥링크.

## 6. 사이드바 & 라우팅
`src/components/layout/AppLayout.tsx` 의 Closure Document 그룹에 항목 추가:
- `ABD Import Logs` (editor+) → `/closure/abd/import/logs`
- `ABD Settings` (admin) → `/closure/abd/settings`

## 7. 산출 파일
- 마이그레이션 1건: `abd_import_row_logs` + 3개 RPC 실장.
- `src/components/abd/import/AbdImportLogsPage.tsx`, `AbdRollbackDialog.tsx`
- `src/components/abd/settings/AbdSettingsPage.tsx`, `AbdHeaderMappingsManager.tsx`, `AbdFieldConfigManager.tsx`
- `src/components/abd/raw-data/AbdDetailSheet.tsx` + `AbdRawDataPage.tsx` 에 마운트.
- `src/routes/_authenticated/closure/abd/import.logs.tsx`, `settings.tsx`
- `src/hooks/useAbdImportLogs.ts`, `src/hooks/useAbdFieldConfig.ts`, `src/hooks/useAbdHeaderMappings.ts`
- `src/lib/abd/abd.functions.ts` 에 rollback/delete/detail wrapper 추가.
- `src/components/layout/AppLayout.tsx` NAV 2행 추가.

## 8. 스코프 제외 (Phase 3)
- ABD Dashboard(요약 카드/차트/지연 리스트)는 Phase 3 에서 별도.
- 사용자 알림/스케줄 리마인더 미포함.

승인 시 위 순서(마이그레이션 → 로그 화면 → Detail → Settings)로 구현합니다.
