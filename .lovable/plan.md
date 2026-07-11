## 결정사항 반영
- **롤업 weight**: 실제 duration = `GREATEST(plan_end − plan_start + 1, 1)` (ALSMK와 동일)
- **auto_judgment 임계값**: 사용자 설정 (Admin > Settings에 임계값 편집 UI + `task_management_settings` 테이블)
- **Import 기본 정책**: "Parent 자동 롤업 = ON" 기본값 (엑셀 parent 값 무시)
- **1차 스코프**: Tree 뷰 + History 포함 (전체 8개 기능)

## 1) 데이터 모델 (마이그레이션)

### 1‑1. `task_management_settings` (임계값)
| 컬럼 | 타입 | 기본 |
| --- | --- | --- |
| id | text pk | `'default'` |
| behind_warn_gap | numeric(6,4) | −0.05 (주의) |
| behind_late_gap | numeric(6,4) | −0.15 (지연) |
| slip_warn_days | int | 3 |
| slip_late_days | int | 14 |
| updated_by | uuid | |
| updated_at | timestamptz | now() |

- 단일 행 (`id='default'`) upsert 방식, RLS: read=authenticated, write=admin
- GRANTS + policies 표준 4단계

### 1‑2. `task_management_status_history`
| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid pk | |
| task_raw_id | uuid fk→task_management_raw.id ON DELETE CASCADE | |
| discipline | text | |
| task_no | text | |
| field | text | 변경 필드명 (actual_progress, auto_judgment 등) |
| old_value | text | |
| new_value | text | |
| source | text | `'manual'` / `'import'` / `'rollup'` |
| changed_by | uuid | auth.users |
| changed_at | timestamptz | now() |

- 인덱스: `(discipline, task_no)`, `(changed_at desc)`
- SPT 히스토리 패턴 재사용

### 1‑3. `task_management_raw` 컬럼 추가
- `auto_judgment_import text` — 엑셀 원본값 보관
- `is_rollup boolean not null default false` — 이 행이 트리거로 갱신됐는지 표시 (parent용)

## 2) 자동 롤업 트리거

### 2‑1. 함수 `public.update_task_summary(_discipline text, _parent_task_no text)`
- `_parent_task_no` 이 null이면 조기 리턴
- 자식 = `SELECT * FROM task_management_raw WHERE discipline=_discipline AND parent_task_no=_parent_task_no AND level='child'`
- 자식 없으면 스킵 (기존 parent 값 유지)
- Duration weight: `d = GREATEST(COALESCE(plan_end - plan_start,0) + 1, 1)`
- 집계:
  - `actual_progress = SUM(actual_progress * d) / SUM(d)` (null은 0으로)
  - `plan_progress = SUM(plan_progress * d) / SUM(d)`
  - `progress_variance = actual_progress − plan_progress`
  - `plan_start = MIN(plan_start)`, `plan_end = MAX(plan_end)`
  - `plan_days = SUM(plan_days)` (또는 duration 합)
  - `actual_start = MIN(actual_start) FILTER (WHERE ...)` 
  - `forecast_end = MAX(forecast_end)`
  - `slip_days = MAX(slip_days)`
  - `auto_judgment` = 자식 중 worst (판정 우선순위: 위험>지연>주의>정상>완료)
- parent UPDATE + `is_rollup=true`

### 2‑2. 함수 `public.calc_auto_judgment(_discipline, _row jsonb)`
- Settings 테이블에서 임계값 조회
- 규칙:
  - `actual_progress >= 1` → `'완료'`
  - `today_gap < behind_late_gap OR slip_days > slip_late_days` → `'위험'`
  - `today_gap < behind_warn_gap OR slip_days > slip_warn_days` → `'지연'`
  - `today_gap < 0` → `'주의'`
  - else → `'정상'`
- `today_gap = actual_progress − expected_progress_today`
- `expected_progress_today = clamp((today − plan_start)/(plan_end − plan_start), 0, 1)`
- 이 함수는 트리거 및 수동 재계산에서 호출

### 2‑3. 트리거 `trg_task_rollup`
- `AFTER INSERT OR UPDATE OF actual_progress, plan_progress, plan_start, plan_end, plan_days, slip_days, forecast_end, actual_start, parent_task_no, level OR DELETE ON task_management_raw`
- FOR EACH ROW: parent가 있으면 `update_task_summary` 호출
- UPDATE에서 `parent_task_no` 변경 시 OLD/NEW 양쪽 재계산
- **주의**: parent 자신이 롤업으로 UPDATE되면 재귀 방지 → `pg_trigger_depth() > 1` 체크로 skip

### 2‑4. History 기록 트리거 `trg_task_history`
- `AFTER UPDATE ON task_management_raw`
- 감시 필드: `actual_progress`, `plan_progress`, `plan_start`, `plan_end`, `actual_start`, `forecast_end`, `slip_days`, `auto_judgment`, `status_manual`
- 값 변경 시 `task_management_status_history`에 INSERT
- `source`는 세션 변수 `app.change_source` (`'manual' | 'import' | 'rollup'`)로 구분. 기본 `'manual'`

## 3) Import 파이프라인 개편 (`TaskManagementImportContext.tsx`)

### 3‑1. 실제 에러 노출 (선결 과제 — 기존 Rejected 137 원인 규명 병행)
- upsert 결과 `error` 캡처 → 콘솔 + `errors` JSONB(`{message, code, details, hint, batch}[]`) + 토스트
- 배치 실패 시 100행 → 1행 fallback 재시도로 문제 행 특정
- `status` = `success | partial | failed`

### 3‑2. 옵션 UI (파일별)
- **Parent 자동 롤업** 라디오: `자동 롤업(기본) | 엑셀 값 유지 | 빈 값만 롤업`
- **Auto‑judgment 재계산**: 체크박스, 기본 ON
- Import 실행 시 파일별로 `SET LOCAL app.change_source = 'import'` (server fn 경유)

### 3‑3. Import 흐름
1. 파싱 → 500행 청크로 upsert (엑셀 parent 원본은 `auto_judgment_import`에 백업, `auto_judgment`는 임시로 그대로 저장)
2. Import 완료 후 서버 fn `runPostImportRollup({discipline, mode})` 호출:
   - `mode='auto'`: 모든 parent에 대해 `update_task_summary` 실행
   - `mode='blank'`: parent의 progress 계열이 NULL인 것만
   - `mode='keep'`: 스킵
3. `recalcAllAutoJudgment({discipline})` — 전체 행 auto_judgment 재계산
4. 결과 요약 (inserted / updated / rolled_up_parents / rejected)

## 4) 파생 표시 (프론트 전용, DB 저장 X)
`src/lib/task-management/derived.ts` 신설:
- `expectedProgressToday(row)` — 오늘 기준 계획 진도율
- `todayGap(row)` — 실적 − 오늘 기준 계획
- `judgmentBadge(row, settings)` — 클라이언트에서도 재계산해 임계값 즉시 반영

Task‑Raw Data 컬럼 정의(`columns.ts`)에 추가 (기본 숨김, 사용자가 컬럼 메뉴에서 켤 수 있음):
- `expected_progress_today` (% 포맷)
- `today_gap` (부호 색상: 음수=red, 양수=green)
- 판정 배지 셀은 파생값 우선, 툴팁에 저장값 노출

## 5) 관리자 툴바 버튼 (Task‑Raw Data 상단)
- **Summary 재계산** — 현재 필터 결과의 parent를 서버에서 재계산 (진행 상황 토스트, `source='manual'`)
- **Auto‑judgment 재계산** — 임계값 변경 후 전체 갱신
- **Threshold 설정 열기** — Admin > Settings 페이지로 링크

## 6) Behind/Critical 대시보드 위젯 (Closure > Dashboard)
- `BehindScheduleCard`: `today_gap < behind_warn_gap` 자식 top 10, discipline 필터
- `CriticalTaskCard`: `auto_judgment IN ('위험','지연')` 카운트 + top 5
- 카드 클릭 → Task‑Raw Data로 이동 + 해당 task_no 하이라이트 (query param)

## 7) Task Tree 뷰
`src/routes/_authenticated/closure/task-management/tree.tsx` 신설 (사이드바 "Task‑Tree"):
- Discipline 탭 (건축/전기/설비)
- Parent 노드(collapsible) → Child 리스트
- Parent 헤더 표시: task_no, task_name, 자식 n개, actual/plan/gap 미니 프로그레스바, worst 판정 배지, 지연 자식 수
- Child 행: 진도율/판정 배지/PIC/기간
- 전체 접기/펴기, 지연만 보기 필터, 검색
- Row 클릭 → 우측 상세 Drawer (raw 값 + history 최근 20건)
- 편집은 Raw Data 페이지로 리다이렉트 (Tree는 읽기 전용)

## 8) 히스토리 뷰
- Tree/Raw Data Drawer에 "히스토리" 탭 — task별 history 20건
- Admin > History 별도 페이지 (선택): discipline·기간·필드 필터, CSV 내보내기

## 9) Threshold 설정 화면
`src/routes/_authenticated/admin/task-thresholds.tsx`:
- 4개 필드 슬라이더 + 숫자 입력
- 미리보기: 현재 데이터에 임계값을 적용하면 정상/주의/지연/위험/완료가 몇 건이 될지 실시간 카운트
- 저장 → 서버 fn으로 upsert + 옵션: "저장 후 전체 auto_judgment 재계산"

## 구현 순서 (제안)
1. **Import 에러 노출 + 원인 규명** (기존 Rejected 137 문제 선결)
2. **마이그레이션 (1‑1, 1‑2, 1‑3 + 2‑1~2‑4 트리거)**
3. **Server fn**: `updateTaskSummary`, `runPostImportRollup`, `recalcAllAutoJudgment`, `getTaskHistory`, `getSettings`/`saveSettings`
4. **Import UI 옵션 + post-import rollup 호출** (자동 롤업 기본 ON)
5. **Task‑Raw Data 파생 컬럼 + 재계산 버튼**
6. **Threshold 설정 화면**
7. **Behind/Critical 대시보드 위젯**
8. **Tree 뷰 + History Drawer**

## 파일 변경 요약
- 신설
  - `supabase/migrations/<ts>_task_rollup.sql`
  - `src/lib/task-management/rollup.functions.ts` (createServerFn)
  - `src/lib/task-management/settings.functions.ts`
  - `src/lib/task-management/history.functions.ts`
  - `src/lib/task-management/derived.ts`
  - `src/components/task-management/raw-data/HistoryDrawer.tsx`
  - `src/components/task-management/tree/TaskTreePage.tsx` + 하위 컴포넌트
  - `src/components/task-management/dashboard/BehindScheduleCard.tsx`, `CriticalTaskCard.tsx`
  - `src/routes/_authenticated/closure/task-management/tree.tsx`
  - `src/routes/_authenticated/admin/task-thresholds.tsx`
- 수정
  - `src/contexts/TaskManagementImportContext.tsx` (에러 노출 + rollup 옵션)
  - `src/components/task-management/import/TaskManagementImportPage.tsx` (라디오/체크박스 옵션)
  - `src/lib/task-management/columns.ts` (파생 컬럼 정의)
  - `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (재계산 버튼, 파생 컬럼)
  - `src/components/layout/AppLayout.tsx` (Task‑Tree, Threshold 메뉴 추가)

## 범위 밖
- Aconex 연동, PDF export, 알림
- 다중 프로젝트/다중 Data Date 관리
