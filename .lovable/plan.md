## 변경 범위

두 개의 매트릭스 UI 수정 (프론트엔드 표시 순서/제목만 변경, 데이터 로직 무변경).

### 1. DMR 대시보드 - `src/components/resource/dmr/DmrDashboardPage.tsx`
- "Subcontractor x 일자 매트릭스" 카드 제목을 **"Daily Manpower Status"** 로 변경
- 매트릭스의 날짜 컬럼 순서를 **역순(최신일이 가장 왼쪽)** 으로 변경
  - 헤더 렌더링용 `dates` 배열을 `[...dates].reverse()` 로 표시
  - 각 행의 셀 렌더링도 동일한 역순 배열 사용
  - 합계/집계 로직은 배열 순서와 무관하므로 그대로 유지

### 2. TM Import Record - `src/components/import-log/task-management/TmImportRecordTab.tsx`
- `MatrixTables`의 날짜 헤더 및 각 사용자 행의 날짜 셀을 **역순** 렌더링
  - `dates` 배열을 표시용으로 reverse 처리
  - 합계 계산(`count`)은 순서와 무관하므로 그대로 유지
- Excel 내보내기(`exportTmImportRecord`)는 이번 지시 범위 밖 → 변경하지 않음 (필요 시 알려주세요)

### 미확인 사항
- DMR 대시보드에 실제로 렌더링되는 매트릭스 컴포넌트 파일은 아직 열어보지 않았습니다. 구현 단계에서 `DmrDashboardPage.tsx`를 먼저 열어 매트릭스 헤더/본문의 `dates` 매핑 위치를 정확히 확인한 뒤 동일 패턴(표시 배열만 reverse)으로 수정합니다.
