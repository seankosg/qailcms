# SM 모듈 Completion → Rectified 전환 계획

DB 마이그레이션은 완료되었습니다(컬럼 rename + `Complete` → `Rectified` 백필 + 스테이지/서치/트리거 함수 재작성). 이제 프론트/서버 코드를 다음과 같이 정리합니다.

## 1. 코드 식별자 리네이밍 (SM 모듈 전용)

`abd_*`, `task_management_*`, `spare_parts_*` 등 다른 모듈의 `completion` 은 절대 건드리지 않습니다. SM 모듈 (`defect_*`, `snag` 폴더) 안에서만 다음을 치환합니다.

- 필드/변수/타입:
  - `completion_status` → `rectified_status`
  - `planned_completion_date` → `planned_rectified_date`
  - `actual_completion_date` → `actual_rectified_date`
  - `completionStatus` / `plannedCompletionDate` / `actualCompletionDate` → `rectified*`
  - `deriveCompletionStatus` → `deriveRectifiedStatus`
  - stage key `"completion"` → `"rectified"` (RPC는 하위호환 유지, 프론트 호출은 신규 키 사용)
- 대상 폴더:
  - `src/lib/defect-management/**`
  - `src/components/defect-management/**`
  - `src/contexts/DefectManagementImportContext.tsx`
  - `src/pages/defect-management/**`, 라우트 파일들
  - Snag Raw Data export 유틸(`exportAllUnclosed.ts`, `export-meta.ts`)

## 2. UI 워딩 (대시보드/프로그레스/Raw Data)

- 헤더/라벨/툴팁/필터명에서 "Completion" → "Rectified", "Complete" → "Rectified" 로 표기.
- Excel export 헤더:
  - `Planned Completion` → `Planned Rectified`
  - `Actual Completion` → `Actual Rectified`
  - `Completion Status` → `Rectified Status`
- 상태 필터 옵션: `Not Started / In Progress / Rectified / (Reopened 별도 표시)`

## 3. 상태 파생 로직 (`deriveRectifiedStatus`)

`status_raw` 기준 매핑:

| status_raw (정규화) | rectified_status | 비고 |
| --- | --- | --- |
| `open` | `Not Started` | |
| `re-opened`, `reopened` | `Not Started` | 대시보드에서 별도 Reopened 카운트 (기존 `status_raw` 기반 유지) |
| `in progress`, `wip` | `In Progress` | Start Date ~ Rectified Date 사이 |
| `rectified` | `Rectified` | |
| `closed` | `Rectified` (+ closure=Closed) | Closed는 Rectified의 후행 스테이지 |

Closure는 `closure_status` 축으로 독립적으로 관리하되, `closure_status = 'Closed'` 이면 항상 `rectified_status = 'Rectified'` 로 강제.

## 4. Import 시 Actual Date 자동 채움

`DefectManagementImportContext` 의 diff 계산에서 각 행별로:

- **In Progress 진입** (`newRS === 'In Progress'` AND `prevRS !== 'In Progress'` AND `!actual_start_date` in row):
  - `actual_start_date := last_updated_at`
- **Rectified 진입** (`newRS === 'Rectified'` AND `prevRS !== 'Rectified'`):
  - `actual_rectified_date := last_updated_at` (없을 때)
  - `actual_start_date := last_updated_at` (없을 때) — 사용자 확정 3번
- **Closed 진입** (`newCS === 'Closed'` AND `prevCS !== 'Closed'`):
  - `actual_closure_date := last_updated_at` (없을 때)
  - `actual_rectified_date := last_updated_at` (없을 때) — 인과 반영
  - `rectified_status := 'Rectified'` (강제)
- **역방향 Closed → 해제** 시엔 `actual_closure_date` 유지 (사용자 지시 없음).

`last_updated_at` 이 없으면 파일의 `data_date` 를 사용, 그것도 없으면 오늘 날짜.

## 5. Reopened 카운트

신규 컬럼 추가 불필요. `dashboard-shape.ts` 가 이미 `status_raw` normalize 결과의 `re-opened / reopen / reopened` 를 별도 `reopen` 버킷으로 집계. UI 라벨만 확인.

## 6. 검증

- `tsgo` (자동)
- 대시보드 카드 카운트/Progress 매트릭스 각 스테이지 값 확인 (as-of 오늘)
- Raw Data 필터에서 Rectified/Closed 옵션 정상 노출
- 재임포트 시나리오 스팟체크: Open→Rectified 전이 파일 → `actual_rectified_date` 자동 채움

---

이대로 진행할까요? 승인해 주시면 코드 리네이밍 + 자동 채움 로직 + UI 워딩을 한 번에 반영합니다.
