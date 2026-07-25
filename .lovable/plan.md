## Phase 5 실행 계획 — UR Aging 설정 · Progress SSOT · Legacy 제거 · Raw Data 컬럼/뱃지

### 1) UR Aging 임계값 설정 popover
- `abd_settings` 테이블에 이미 존재하는 `ur_aging_warn_days`, `ur_aging_late_days` 필드를 사용.
- 대시보드 헤더(Batch/As of/Refresh 옆)에 "Aging Settings" popover 버튼 추가.
  - Warn(주의) / Late(지연) 일수 두 필드, 저장 시 `upsert` 후 관련 쿼리 invalidate.
  - 권한: admin/superuser/d_superuser만 편집, 그 외 read-only 표시.
- 서버 함수 `getAbdSettings` / `updateAbdSettings`(createServerFn, `requireSupabaseAuth` + 역할 체크) 신설.
- `AbdRow6Attention`의 UR Aging 탭 배지에 현재 임계값 표기.

### 2) Progress SSOT 이관
- 현재 `AbdDashboardPage`는 신규 RPC 기반 Row 1~6 + 구 `loadAbdDashboardData` 기반 Focus/Trend/Attention/CrossCut을 병행 → SSOT 이원화.
- 조치:
  - `loadAbdDashboardData` 사용 중단(대시보드에서 호출 제거). 파일은 남기되 `@deprecated` 주석과 export 축소.
  - 신규 RPC (`abd_dashboard_row1/row2/status_dist/approval_trend/overdue_heatmap/attention_lists/crosscut`)만을 유일한 소스로 사용.
  - Progress 페이지의 요약 카드(있다면) 역시 동일 RPC로 통일하여 대시보드와 수치 일치 보장.

### 3) Legacy 섹션 제거
- `AbdDashboardPage.tsx`에서 다음 블록 삭제:
  - Focus + Trend 카드 (`FocusCard`, `TrendCard`)
  - Attention/CrossCut 구버전 섹션(`AttentionSection`, `CrossCutSection`)
  - 관련 헬퍼 (`MiniStat`, `RiskChip`, `StageFunnel`) 미사용 시 함께 제거.
- 상단 안내문/subtitle 최신 흐름(NS/DS/UR/Approved 5분류)에 맞춰 정리.

### 4) Raw Data 컬럼/뱃지
- 라운드 워크플로 필드가 스키마에는 있으나 Raw Data 표에 미노출인 항목 노출:
  - `latest_status`(A/B/C/UR/NS) — 색상 뱃지 (A=emerald, B/C=amber, UR=blue, NS=slate).
  - `current_stage`(NS/DS/UR/Approved) 뱃지.
  - `ur_aging_days` — 임계값(설정값) 대비 색상 (green<warn ≤ amber<late ≤ red).
  - `overdue_kind`(RS/SB/DS/None) 배지.
- `AbdColumnFilterDropdowns`에 `latest_status`, `current_stage`, `overdue_kind` 다중 선택 필터 추가.
- 컬럼 정의(라벨/기본 표시 여부/order) 업데이트, `useMwsColumnPrefs` 저장 스키마와 호환 유지.

### 기술 상세
- 신규 파일:
  - `src/lib/abd/settings.functions.ts` — get/update server fn + Zod input validator.
  - `src/components/abd/dashboard/AbdAgingSettingsPopover.tsx`.
- 수정 파일:
  - `src/components/abd/dashboard/AbdDashboardPage.tsx` — legacy 삭제, 설정 popover 배치.
  - `src/components/abd/dashboard/AbdChartsRows.tsx` — UR Aging 탭 배지에 임계값 노출, 임계값 기반 컬러링.
  - `src/components/abd/raw-data/AbdRawDataPage.tsx`, `AbdColumnFilterDropdowns.tsx`, `AbdColumnOrderMenu.tsx` — 컬럼/필터 추가.
  - `src/lib/abd/dashboard-data.ts` — deprecated 표시(삭제는 다음 라운드).
- 마이그레이션: 없음(스키마·RPC 이미 존재).

### 검증
- `tsgo --noEmit` 통과.
- 대시보드에서 batch 필터 · aging 임계값 조정이 즉시 Row1~6에 반영.
- Raw Data에서 신규 컬럼/뱃지/필터 동작 확인.
