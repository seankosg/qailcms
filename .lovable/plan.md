## 1. 배경 및 스코프

SHAW PROJECT CMS의 T&C `/tc/schedule-revision` 페이지(`src/pages/ScheduleRevisionPage.tsx`, 482줄)를 우리 앱 TM 모듈의 Raw Data 아래에 그대로 이식합니다. 사용자 답변에 따라 추적 스테이지는 **Plan Start / Plan End / Forecast End 3개**로 구성하며, 이력 기록은 **임포트 시 앱 로직에서 diff 감지**, 덮어쓰기 정책은 **항상 덮어쓰기(빈 값이면 NULL 클리어)** 로 확정.

## 2. DB 변경

### 2-1. `task_schedule_change_audit` 신규 테이블
- 컬럼: `id`, `created_at`, `import_log_id`, `task_raw_id`, `task_no`, `main_task_no`, `discipline`, `team`, `plot`, `task_name`, `hdec_pic_name`, `hdec_eng_name`, `source_file`, `raw_row_no`
- 스테이지별 diff 컬럼 (3 스테이지 × 5 필드):
  - `plan_start_old_date`, `plan_start_new_date`, `plan_start_diff_days`, `plan_start_prev_gap_days`, `plan_start_cur_gap_days`
  - `plan_end_old_date`, `plan_end_new_date`, `plan_end_diff_days`, `plan_end_prev_gap_days`, `plan_end_cur_gap_days`
  - `forecast_end_old_date`, `forecast_end_new_date`, `forecast_end_diff_days`, `forecast_end_prev_gap_days` (마지막 스테이지 → Cur.Gap 없음)
- GRANT + RLS: `authenticated` 읽기, admin/superuser 전체 관리, 임포트 소유자 INSERT
- 인덱스: `created_at DESC`, `task_raw_id`, `import_log_id`

### 2-2. `backup-tables.ts` 목록에도 `task_schedule_change_audit` 추가(백업 스냅샷 포함)

## 3. 임포트 로직 수정 (`src/contexts/TaskManagementImportContext.tsx`)

### 3-1. 덮어쓰기 정책 변경
- `stripNullExcept` 예외 목록에 **모든 케이스에서 `plan_start`, `plan_end`, `forecast_end` 를 항상 포함**시켜, 파일 값이 비어있어도 DB에 NULL로 반영되도록 수정. (현재는 `stripParent=true` 케이스에만 포함됨)

### 3-2. Diff 감지 및 audit 기록
- 배치 upsert 직전, 대상 payload들의 `(discipline, task_no)` 목록으로 기존 `task_management_raw`에서 `id, plan_start, plan_end, forecast_end` 를 조회.
- 각 payload에 대해 old vs new 를 비교하여 변경 시에만 audit row 구성:
  - `diff_days = new - old` (일 단위)
  - `prev_gap_days = old_stage_next - old_stage_this` (스테이지 간 이전 간격)
  - `cur_gap_days = new_stage_next - new_stage_this` (마지막 스테이지 제외)
- upsert 성공 이후 `task_schedule_change_audit` 에 배치 insert.
- 실패해도 임포트 자체는 계속 진행 (로그만 남김).

## 4. 프론트 페이지 신규

### 4-1. 라우트
- `src/routes/_authenticated/closure/task-management/schedule-revision.tsx` 생성 → `TaskScheduleRevisionPage` 컴포넌트 마운트.

### 4-2. 컴포넌트 `src/components/task-management/schedule-revision/TaskScheduleRevisionPage.tsx`
- SHAW 원본과 동일한 구조 그대로 이식(누락 금지):
  - TanStack Table + `getSortedRowModel` + `getFilteredRowModel`
  - 3종 필터 드롭다운(`TextFilterDropdown`, `DateRangeDropdown`, `MultiSelectDropdown`) + `Empty only` 옵션 + `Clear all`
  - `SortableHeader` 정렬 표시(▲/▼)
  - 2단 헤더 (스테이지 그룹 colSpan + 서브헤더 5칸/4칸)
  - `CalendarClock` 아이콘 + "Recent 500 records · {n} of {N} revisions" 헤딩
  - 필터 개수 뱃지, `Clear filters`, `Clear sort` 버튼
  - Sticky header, `max-h-[680px] overflow-auto`
  - 스타일 클래스(`diffClass`: 양수 destructive, 음수 primary), `formatDdMmm`, `formatSignedDays` 유틸
- 컬럼 매핑 (좌측 고정):
  - Changed At (date-range) / Row / Discipline (multi-select) / Team (multi-select) / Task No / Main Task No / Task Name / Plot / HDEC PIC / HDEC ENG
- 스테이지 라벨: `PS = Plan Start`, `PE = Plan End`, `FE = Forecast End`
- 스테이지 후행 여부: PS·PE 는 Cur.Gap 표시, FE 는 없음 (마지막)
- 행 클릭 시 `/closure/task-management/detail/{task_raw_id}` 로 navigate
- 데이터 소스: `task_schedule_change_audit` 최근 500건 + `task_management_raw` 조인(task_no/task_name 등은 감사 테이블에 스냅샷돼 있어 조인 없이 표시)

### 4-3. 유틸리티
- `src/lib/format.ts` 에 없으면 `formatDateTimeDdMmmYyyy`, `formatDdMmm`, `formatSignedDays` 추가.

## 5. 사이드바 메뉴

`src/components/layout/AppLayout.tsx` Task Management 섹션에 Raw Data 바로 아래 추가:
```
{ to: "/closure/task-management/schedule-revision", label: "Schedule Revision", icon: CalendarClock }
```

## 6. 셀프 체크리스트 (레퍼런스 원본과 diff 검증)

| SHAW 원본 요소 | 이식 여부 |
|---|---|
| TanStack Table + Sort + Filter model | ✓ |
| Text/Date-range/Multi-select 필터 드롭다운 3종 | ✓ |
| Empty only 체크박스 | ✓ |
| Clear filters / Clear sort 버튼 | ✓ |
| 스테이지 그룹 2단 헤더 + colSpan | ✓ |
| 마지막 스테이지 Cur.Gap 제외 | ✓ (FE) |
| diffClass 양수/음수 색상 | ✓ |
| Sticky header + max-h scroll | ✓ |
| Recent 500 · N of M revisions 헤딩 | ✓ |
| 행 클릭 → 상세 이동 | ✓ (detail.$id) |
| CalendarClock 아이콘 | ✓ |

## 7. 작업 순서

1. **[승인 대기]** `task_schedule_change_audit` 마이그레이션 → 승인 후 실행 및 타입 재생성.
2. `TaskManagementImportContext.tsx` 덮어쓰기 정책 및 diff 감지/insert 로직 추가.
3. `TaskScheduleRevisionPage` 컴포넌트 + 라우트 파일 생성.
4. `AppLayout` 사이드바 메뉴 추가.
5. `backup-tables.ts` 백업 대상에 추가.
6. 빌드 확인 후 사용자에게 검증 요청.

## 8. 리스크 및 주의

- Diff 감지 시 기존 DB조회를 배치별로 하므로 대용량(1000+) 임포트에서 라운드트립이 늘어남 → `IN (task_no…)` 로 한 번에 조회하여 최소화.
- Forecast End 는 파서에서 100% 완료 시 자동 채움 규칙이 있으므로, "임포트 파일의 값"이 아니라 "파서 산출값" 기준 diff 로 통일(사용자에겐 실제 저장값 변화가 보이는 게 자연스러움).
- 롤업 Main Task 는 plan_start/plan_end 가 자식에서 강제 null 화되므로 audit에서 제외(row_type = 'sub' 만 기록).
