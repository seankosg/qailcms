# Task Management Raw Data 구현 계획 (뷰어/필터/편집 포함)

QAIL 프로젝트의 건축/전기/설비 Task Management Excel(Gantt 시트)을 Supabase에 저장하고, Spare Part 모듈과 동일한 패턴으로 **DB + Import + Raw Data 뷰어(필터/편집)** 까지 구현합니다.

## 0. 사이드바 메뉴명 정리

| 기존 라벨 | 신규 라벨 | 경로 |
|---|---|---|
| Raw Data (Spare Part) | **SPT-Raw Data** | `/closure/spare-part/raw-data` (그대로) |
| — (신설) | **Task-Raw Data** | `/closure/task-management/raw-data` |

`src/components/layout/AppLayout.tsx` NAV 배열에서 Spare Part 그룹의 "Raw Data" 항목 라벨을 "SPT-Raw Data"로 수정하고, Task Management 그룹을 신설하여 "Task-Raw Data" 항목 추가. 페이지 헤더 제목(h1)과 route `head().meta.title`도 동일하게 반영.

## 1. 데이터 모델 (Supabase 마이그레이션)

### 1-1. `task_management_raw`
Gantt의 부모(항목)/자식(실행·승인·대기)을 한 테이블에 평탄화. 부모 속성(Category/Plot/항목/리스크)은 자식 행에도 propagate 저장.

**컬럼**
- `id` uuid PK
- `task_no` text NOT NULL (A)
- `parent_task_no` text (자식이면 3-segment 부모 ID)
- `level` text check in ('parent','child')
- `discipline` text check in ('건축','전기','설비')
- `category` text (B, propagate)
- `plot` text (C, 'C'|'D', propagate)
- `task_name` text (D, propagate)
- `risk` text (E, Critical/High/Med/Low, propagate)
- `sub_task_desc` text (F, child)
- `pic` text (G)
- `row_type` text (H, `항목`/`실행`/`승인`/`대기`)
- `status_manual` text (I, `예정`/`진행`/`완료`)
- `plan_start` date (J), `plan_end` date (K), `plan_days` int (L)
- `actual_start` date (M), `actual_progress` numeric(6,4) (N)
- `plan_progress` numeric(6,4) (O), `progress_variance` numeric(6,4) (P)
- `forecast_end` date (Q), `slip_days` int (R), `auto_judgment` text (S)
- `data_date` date NOT NULL (파일 C4)
- `sort_order` int, `source_file` text
- `imported_at` timestamptz, `imported_by` uuid FK auth.users
- `created_at`, `updated_at` timestamptz

**Unique**: `(discipline, task_no)` — upsert 키.
**GRANT**: authenticated SELECT/INSERT/UPDATE/DELETE, service_role ALL.
**RLS**: 로그인 사용자 read-all, admin만 write.

### 1-2. `task_management_import_logs`
`spare_parts_import_logs` 축약판: `file_name`, `discipline`, `data_date`, `total_rows`, `inserted`, `updated`, `skipped`, `rejected`, `errors` jsonb, `status`, `imported_by`, `started_at`, `finished_at` + 감사 컬럼. GRANT/RLS 동일.

## 2. 파서 (`src/lib/task-management/parser.ts`)

`xlsx`로 워크북 로드 → `Gantt` 시트.
1. **C4 → data_date** 추출
2. **Row 5 헤더 검증** — 위치 불일치(전기/설비 파일 가능)시 헤더 텍스트 매핑 fallback + 경고 반환
3. **Row 7~**: A와 F가 모두 비면 종료
4. `task_no` 세그먼트 수로 parent(3)/child(4) 판정
5. 최근 부모 캐시 → 자식에 category/plot/task_name/risk propagate
6. 날짜 → ISO date, 진도율 숫자 유지, 빈 셀 → null
7. T열(20) 이후 무시
8. 반환 `{ dataDate, rows, warnings }`

Discipline은 UI에서 파일별 선택. `task_no` 접두어(AC/AD → 건축 등)로 기본값 힌트.

## 3. Import UI — 기존 Import 라우트를 탭 컨테이너로

`src/routes/_authenticated/closure/spare-part/import.tsx`를 shadcn `<Tabs>`로 감싸고 "Spare Part" | "Task Management" 두 탭. 기존 Spare Part 임포트 로직은 그대로 유지.

### `TaskManagementImportPage`
`src/components/task-management/import/TaskManagementImportPage.tsx` + `TaskManagementImportContext.tsx`.
- 드래그앤드롭/클릭 업로드(xlsx/xlsm)
- 파일 카드: Discipline 셀렉트, 파싱 요약(Data Date/부모수/자식수/경고), 상위 20행 Preview
- 500행 chunk upsert `(discipline, task_no)`
- 결과 배지(Inserted/Updated/Skipped/Rejected) + `task_management_import_logs` 기록
- 비관리자는 Start 비활성

경로/사이드바 Import 항목은 변경 없음.

## 4. 서버 함수 (`src/lib/task-management/*.functions.ts`)

- `importTaskManagementFn` — `requireSupabaseAuth` + admin. 500행 chunk upsert, 로그 insert
- `updateTaskManagementRowFn` — 단건 업데이트(허용 필드 화이트리스트)
- `bulkUpdateTaskManagementFn` — Bulk Edit chunk update
- `deleteTaskManagementRowsFn` — Hard delete(admin)
- 조회는 클라이언트에서 `supabase` publishable 클라이언트로 select

## 5. Raw Data 뷰어 (Task-Raw Data)

### 5-1. 라우트/파일
- `src/routes/_authenticated/closure/task-management/raw-data.tsx`
  - `head().meta.title = "Task Management — Task-Raw Data"`
  - 페이지 헤더 h1 = "Task-Raw Data"

```
src/components/task-management/raw-data/
  TaskManagementRawDataPage.tsx
  columns.ts
  filters.ts
  ColumnFilters.tsx
  ColumnOrderMenu.tsx
  TopHorizontalScrollbar.tsx
  BulkEditBar.tsx
  ExportDialog.tsx
  dialogs/
    BulkConfirmDialog.tsx
    BulkDeleteDialog.tsx
    EditCellPopover.tsx
```
TanStack Table v8 + TanStack Query. 서버에서 전체 fetch 후 클라이언트 필터/정렬(Spare Part와 동일 패턴).

### 5-2. 컬럼 그룹
- **id**: task_no, level, discipline
- **task**: category(badge), plot(badge), task_name, risk(badge), sub_task_desc, pic, row_type(badge)
- **status**: status_manual(badge), auto_judgment(badge)
- **plan**: plan_start(date), plan_end(date), plan_days(number)
- **actual**: actual_start(date), actual_progress(percent)
- **forecast**: plan_progress(percent), progress_variance(percent), forecast_end(date), slip_days(number)
- **system**: data_date, source_file, imported_at, imported_by

Badge 색상: risk(Critical=red/High=amber/Med=sky/Low=emerald), row_type(항목=slate/실행=indigo/승인=violet/대기=zinc), status_manual(예정=zinc/진행=sky/완료=emerald), auto_judgment(완료=emerald/지연=red/주의(미착수)=amber/진행=sky/예정=zinc), plot(C=blue/D=violet).

### 5-3. 필터
- multi-select: discipline, plot, category, risk, row_type, status_manual, auto_judgment, level, pic
- date-range: plan_start, plan_end, actual_start, forecast_end, data_date
- number-range: plan_days, actual_progress, plan_progress, progress_variance, slip_days
- text: task_no, task_name, sub_task_desc

전역 검색: `task_no`, `task_name`, `sub_task_desc`, `pic`, `category`.

### 5-4. 편집 (admin only)
셀 클릭 → 팝오버 인라인 편집. 편집 가능 필드 화이트리스트:
- `status_manual`, `row_type` (select)
- `pic`, `category`, `task_name`, `sub_task_desc` (text)
- `risk` (select)
- `plan_start`, `plan_end`, `actual_start`, `forecast_end` (date)
- `actual_progress` (number 0~1)

**편집 금지(자동 계산 스냅샷)**: `plan_days`, `plan_progress`, `progress_variance`, `slip_days`, `auto_judgment`, 부모 `actual_progress`.

### 5-5. Bulk Edit / Delete / Export
Spare Part의 `BulkEditBar` 상단 배치 패턴 그대로 이식:
- Bulk Edit: 편집 가능 필드 그룹에서 필드 선택 → 값/Blank → Preview → 500행 chunk update
- Hard Delete: "DELETE" 타이핑 확인 → 200행 chunk delete (자식 테이블 없음, 단순 delete)
- Export: 현재 화면 컬럼 순서/라벨 그대로 xlsx 다운로드 + TSV 클립보드 복사

### 5-6. 상단 툴바
전역 검색, 필터 chip + Clear all, Bulk Edit Bar(선택 시), 컬럼 순서/표시 메뉴, Export 드롭다운, Data Date 배지.

## 6. 사이드바 갱신 (`src/components/layout/AppLayout.tsx`)

```ts
{
  label: "Closure Document",
  icon: Package,
  items: [
    { to: "/closure/spare-part/dashboard", label: "Dashboard", ...},
    { to: "/closure/spare-part/raw-data", label: "SPT-Raw Data", ...},   // 라벨 변경
    { to: "/closure/spare-part/import", label: "Import", ...},
    { to: "/closure/spare-part/import/logs", label: "Import Logs", ...},
    { to: "/closure/spare-part/aconex-sync", label: "Aconex Sync", ...},
  ],
},
{
  label: "Task Management",
  icon: ListTodo,
  items: [
    { to: "/closure/task-management/raw-data", label: "Task-Raw Data", icon: Database },
  ],
},
```
Spare Part Raw Data 페이지 자체의 h1도 "SPT-Raw Data"로, route `head().meta.title`도 "Spare Part — SPT-Raw Data"로 동기화.

## 7. 수용 기준

- 마이그레이션 후 `task_management_raw`, `task_management_import_logs` 생성 + RLS/GRANT.
- 사이드바에 "SPT-Raw Data", "Task-Raw Data" 두 항목이 각각의 그룹에 노출.
- Import 화면에 "Spare Part" / "Task Management" 탭. Spare Part 기존 기능 회귀 없음.
- `20260710_Task_Management_건축.xlsx` 임포트: Data Date=2026-07-09, 137행 성공, 자식에 부모 속성 propagate 확인. 재임포트 시 Updated 137/Inserted 0.
- Task-Raw Data 페이지에서 임포트된 데이터가 그룹 헤더/배지/필터와 함께 표시.
- 관리자: 인라인 편집, Bulk Edit(Preview 반영), Bulk Hard Delete("DELETE" 확인), Export(xlsx/TSV) 정상. 자동 계산 컬럼 편집 불가.
- 비관리자: 조회만, 편집/삭제/임포트 버튼 비활성.

## 8. 이번 계획에 포함하지 않는 것

- Task Management Dashboard / 일일 모니터링 재현
- 상세 시트(`AC-T-01_Ishtiyaque` 등) 파싱
- 자동 판정/진도율 재계산 로직 — 임포트 스냅샷 신뢰
- Task별 상세(detail) 페이지
- Import Logs 전용 뷰어

## 9. 마이그레이션 SQL 개요

```sql
create table public.task_management_raw (
  id uuid primary key default gen_random_uuid(),
  task_no text not null,
  parent_task_no text,
  level text not null check (level in ('parent','child')),
  discipline text not null check (discipline in ('건축','전기','설비')),
  category text, plot text, task_name text, risk text,
  sub_task_desc text, pic text, row_type text, status_manual text,
  plan_start date, plan_end date, plan_days int,
  actual_start date, actual_progress numeric(6,4),
  plan_progress numeric(6,4), progress_variance numeric(6,4),
  forecast_end date, slip_days int, auto_judgment text,
  data_date date not null,
  sort_order int,
  source_file text,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discipline, task_no)
);
grant select, insert, update, delete on public.task_management_raw to authenticated;
grant all on public.task_management_raw to service_role;
alter table public.task_management_raw enable row level security;
create policy "tmr read authenticated" on public.task_management_raw
  for select to authenticated using (true);
create policy "tmr admin write" on public.task_management_raw
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));
create trigger tmr_set_updated_at before update on public.task_management_raw
  for each row execute function public.set_updated_at();
-- + task_management_import_logs (동일 GRANT/RLS 패턴)
```
