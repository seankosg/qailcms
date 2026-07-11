
## 목표
Task Management Raw Data에 `team` 컬럼을 추가하고, Import 시 파일별로 선택한 공종(discipline) 값을 그대로 `team`으로 저장한다. 향후 새 팀(예: 통신, 소방 등) 추가 시 discipline 목록만 확장하면 자동 반영된다.

## 1. DB 마이그레이션
- `task_management_raw` 에 `team text` 컬럼 추가 (nullable)
- 인덱스 `idx_tmr_team`
- 백필: `UPDATE task_management_raw SET team = discipline WHERE team IS NULL`
- `task_management_field_config` 에 `team` seed 1행 (Display "Team", group `id`, sort_order 25)
- `task_management_header_mappings` 에 기본 별칭 (`Team`, `팀`) → `team` 시스템 매핑 seed

## 2. 컬럼 정의 (`src/lib/task-management/columns.ts`)
- `TmColumnDef` 에 `team` 추가: type `badge`, group `id`, width 90, 편집 불가
- `TEAM_COLORS` 맵 (discipline 색상 재사용 + 미매핑 fallback)

## 3. Import
- `TaskManagementImportContext.tsx` 의 chunk insert payload 조립부에서 `team: file.discipline` 을 함께 저장

## 4. Raw Data 페이지
- Team 컬럼 자동 노출 (TM_COLUMNS 정의로 자동 처리)
- 배지 렌더링 스위치에 `team` 케이스 추가
- Export 컬럼 목록에도 자동 포함

## 5. Rollup / History
- 기존 rollup, history 트리거는 team 미사용 → 변경 불필요

## 파일 변경 예상
- 신규 마이그레이션 SQL
- 수정: `src/lib/task-management/columns.ts`, `src/contexts/TaskManagementImportContext.tsx`, `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (렌더링)
