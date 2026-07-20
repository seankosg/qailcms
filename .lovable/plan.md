# TM Import Logs — 2탭 구조 및 HDEC PIC 일자별 업로드 매트릭스

## 개요

`/import-log/logs?tab=task` 화면을 두 개의 하위 탭으로 재구성합니다.

1. **Import File** — 기존 `ImportLogsPage kind="task_management"` 그대로 유지 (파일 단위 실행 이력).
2. **Import Record** — 활성 HDEC PIC × 최근 30일 매트릭스 (신규). Super User 이상만 접근, 팀별 그룹, Excel 내보내기 지원.

## 스코프 요약 (답변 반영)

- 날짜 범위: **최근 30일** (오늘 포함). 사용자가 종료일을 조정 가능.
- 업로드 판정: 해당 사용자의 **`task_management_import_logs` 존재 여부** (성공/실패 무관, `imported_by = 사용자 id` AND `started_at` KST 날짜가 해당 일자와 일치).
- 대상 사용자: `profiles.is_active = true` AND (`user_type = 'hdec_pic'` OR `hdec_pic_name` 이 채워진 계정) 전원.
- 셀 표시: **O / X 아이콘**. 주말은 헤더/셀 배경을 흐리게. 오늘 열은 강조.
- 접근 권한: `superuser`, `admin` 만 탭 노출 (Sidebar 링크는 유지하되 진입 시 권한 없으면 탭 숨김 + 안내).

## UI 구조

```text
Import Logs 페이지
  Tabs (기존): Task Management | Snag List | Spare Part | ABD | Warranty
    └ Task Management 컨텐츠 내부에 하위 Tabs 추가
        ├─ [Import File]  → 기존 <ImportLogsPage kind="task_management" />
        └─ [Import Record] → 신규 컴포넌트 (superuser+ 만)
```

Import Record 하위 탭 레이아웃:

```text
┌ Toolbar ────────────────────────────────────────────────────┐
│ 기간: [2026-06-20] ~ [2026-07-20]  [최근 30일] [이번달]   │
│ 팀 필터: [전체 ▼]   검색: [이름/로그인ID]                │
│                                     [Excel 내보내기] 버튼 │
└─────────────────────────────────────────────────────────────┘
┌ 팀별 그룹 (Collapsible) ────────────────────────────────────┐
│ ▼ Team A  (12명 / 오늘 업로드 8명 / 미업로드 4명)          │
│  ┌──────┬─────┬─────┬───┬───┬───┬───┬───┬────────────┐   │
│  │ 이름 │Team │ID   │D-29│…│D-1│Today│ 30일합계     │   │
│  ├──────┼─────┼─────┼───┼───┼───┼───┼───┼────────────┤   │
│  │ 홍길동│ A  │hgd  │ O │ X │ O │ … │ O │ 22 / 30    │   │
│  └──────┴─────┴─────┴───┴───┴───┴───┴───┴────────────┘   │
│ ▶ Team B ...                                              │
└─────────────────────────────────────────────────────────────┘
```

- 첫 3개 컬럼(이름/팀/로그인ID) sticky, 사용자 이름 클릭 시 admin 프로필 페이지로 이동.
- 셀 hover 시 해당 날짜 업로드 건수 툴팁.
- 팀 그룹 헤더에 "오늘 미업로드 N명" 뱃지 → 클릭 시 해당 팀 미업로드자만 필터.

## 데이터 흐름

1. **사용자 목록 조회 (client, Supabase)**
   - `profiles` 에서 `is_active=true` AND (`user_type='hdec_pic'` OR `hdec_pic_name IS NOT NULL`) 인 행을 team 오름차순, name 오름차순으로 가져옴.
2. **업로드 이력 집계 (server function)** — 신규 `getTmImportRecordMatrix`
   - 입력: `from`, `to` (ISO date, KST 기준).
   - 처리: `task_management_import_logs` 에서 `started_at >= from 00:00 KST AND started_at < to+1 00:00 KST` 인 행을 `imported_by`, `date_trunc('day', started_at AT TIME ZONE 'Asia/Seoul')` 로 GROUP BY 하여 `{ user_id, date, count }[]` 반환.
   - `requireSupabaseAuth` 미들웨어 + 내부에서 `has_role(admin/superuser)` 체크. 그 외에는 401/403.
3. **매트릭스 조립 (client)**
   - 사용자 × 날짜 그리드 생성. 셀 count>=1 → O, 아니면 X.

## Excel 내보내기

`src/lib/excel/stream-export.ts` 의 `streamXlsxExport` (SHAW 스타일 헤더) 재사용:

- 파일명: `tm-import-record_{from}_{to}.xlsx`
- 시트 컬럼: 팀 / 이름 / 로그인ID / (날짜 컬럼 30개) / 업로드일수 / 미업로드일수(주말제외) / 최근 업로드일
- 셀 값: `O` / `X` (문자열). O는 초록 배경(`FFD1FAE5`), X는 빨강 배경(`FFFEE2E2`), 주말은 회색 배경.
- Title: "TM Import Record — {from} ~ {to}"
- MetaRows: Exported by / Source: task_management_import_logs / Search / Filters(팀) / Sort.
- Freeze: 3열 + 상단 헤더 8행.

## 권한 처리

- `Import Record` 서브탭 자체를 `useCurrentUser()` 결과 기준 `isAdmin || isSuperUser` 일 때만 `TabsTrigger` 렌더.
- 직접 URL(`?tab=task&sub=record`) 진입해도 서버 함수가 role 재검증하므로 데이터 노출 없음.
- URL 상태: `search.sub`(=`file`|`record`)를 zod로 추가, 기본값 `file`.

## 파일 변경 목록

**신규**
- `src/lib/task-management/import-record.functions.ts` — `getTmImportRecordMatrix` 서버 함수.
- `src/lib/task-management/import-record-export.ts` — Excel 내보내기 헬퍼.
- `src/components/import-log/task-management/TmImportRecordTab.tsx` — 매트릭스 UI, 필터, 팀 그룹.
- `src/components/import-log/task-management/TmImportRecordMatrix.tsx` — 순수 렌더 컴포넌트.

**수정**
- `src/components/import-log/ImportLogsHubPage.tsx` — Task Management TabsContent 내부에 하위 Tabs (Import File / Import Record) 추가, superuser+ 조건부 노출.
- `src/routes/_authenticated/import-log/logs.tsx` — `searchSchema` 에 `sub` 필드 추가.

**변경 없음**
- `ImportLogsPage.tsx`, 기존 로그 컬럼/RLS. 조회는 `imported_by` 기반이며 현재 `task_management_import_logs` SELECT 정책이 이미 authenticated 에게 열려 있음(별도 마이그레이션 불필요, 배포 전 재확인).

## 검증

1. Type check.
2. 프리뷰: `superuser` 계정으로 Import Record 탭 노출 확인, 일반 user 계정으로 탭 미노출 확인.
3. DB: `psql` 로 최근 30일 `task_management_import_logs` 샘플 카운트와 UI 매트릭스 O 개수가 일치하는지 스팟체크.
4. Excel: 파일 다운로드 → 열어서 팀/사용자/O·X/총계 컬럼 정확성 확인.