
## 목표
사이드바에 최상위 섹션 **Import & Log**를 신설하고, 각 모듈(Task Management / Snag List / Spare Part / ABD)에 흩어져 있는 Import 및 Import Logs 화면을 각 페이지 내부의 **탭**으로 통합합니다. Export 페이지는 만들지 않습니다. 각 Raw Data 페이지의 기존 바로가기 버튼은 유지하되, 새 통합 라우트로 연결합니다.

## 사이드바 구조 (`src/components/layout/AppLayout.tsx`)

```text
Outstanding Work
  Dashboard
  Task Management …
  Snag List Management …
Close-Out Doc
  Dashboard
  ABD / Spare Part / Warranty …
Import & Log           ← 신규 최상위 섹션
  Import               (/import-log/import)
  Import Logs          (/import-log/logs)
Admin …
```

- 아이콘: `Upload`(Import), `FileClock`(Import Logs). 섹션 자체는 라벨만.
- `editorOnly: true`로 노출 제한(기존 각 모듈의 import/logs 링크와 동일 정책).
- Warranty & License 모듈 내부 링크는 변경 없음.

## 신규 라우트

- `src/routes/_authenticated/import-log/import.tsx`
  - `createFileRoute("/_authenticated/import-log/import")`
  - `validateSearch`로 `tab` 파라미터: `task | snag | spare-part | abd | warranty`, 기본 `task`.
  - `head`: "Import — QAIL CMS".
- `src/routes/_authenticated/import-log/logs.tsx`
  - `createFileRoute("/_authenticated/import-log/logs")`
  - 동일한 `tab` 검색 파라미터.
  - `head`: "Import Logs — QAIL CMS".

## 신규 컨테이너 컴포넌트

### `src/components/import-log/ImportHubPage.tsx`
- 상단 제목 + 설명.
- `Tabs` (shadcn) — 값: `task`, `snag`, `spare-part`, `abd`, `warranty`.
- `useSearch`/`useNavigate`로 현재 탭을 URL과 양방향 동기화(모듈별 딥링크 유지).
- 탭 컨텐츠:
  - **Task Management**: 기존 `TaskManagementImportPage` 그대로 렌더.
  - **Snag List**: 기존 `DefectManagementImportPage` 그대로 렌더.
  - **Spare Part**: 현재 `src/routes/_authenticated/closure/spare-part/import.tsx` 내부에 인라인 정의된 Spare Part 임포트 UI(`SparePartImportProvider` + `ImportPage` + `FileRow` + `ColumnSelectDialog`)를 그대로 `src/components/spare-part/import/SparePartImportPage.tsx`로 이전 후 이 파일에서 import. 로직/문구/파라미터 변경 없음.
  - **ABD**: 기존 `AbdImportPage` 그대로 렌더.
  - **Warranty**: "Coming soon" placeholder 카드(비활성).

### `src/components/import-log/ImportLogsHubPage.tsx`
- 동일한 5개 탭 구조.
- 각 탭에서 기존 `ImportLogsPage` 컴포넌트를 모듈별 props로 재사용 — 현재 `closure/*/import.logs.tsx`가 넘기는 props를 그대로 복제.
- Warranty 탭은 placeholder.

## 기존 모듈별 Import/Logs 라우트 처리

기존 URL은 유지하며 새 통합 페이지로 연결하기 위해 **리다이렉트 라우트**로 축소:

- `closure/abd/import.tsx` → `/import-log/import?tab=abd`
- `closure/abd/import.logs.tsx` → `/import-log/logs?tab=abd`
- `closure/snag-management/import.index.tsx` → `?tab=snag`
- `closure/snag-management/import.logs.tsx` → `?tab=snag`
- `closure/spare-part/import.tsx` → `?tab=spare-part`
- `closure/spare-part/import.logs.tsx` → `?tab=spare-part`
- `closure/task-management/import.logs.tsx` → `?tab=task`

구현: `createFileRoute(...)({ beforeLoad: () => { throw redirect({ to: "/import-log/import", search: { tab: "…" } }) } })`.

## Raw Data 바로가기 버튼

현재 존재하는 것만 유지하고 새 통합 라우트로 target만 갱신:

| 파일 | 현재 링크 | 변경 후 |
|---|---|---|
| `AbdRawDataPage.tsx` | `/closure/abd/import` | `/import-log/import` + `search={{ tab: "abd" }}` |
| `DefectRawDataPage.tsx` | `/closure/snag-management/import` | `/import-log/import` + `search={{ tab: "snag" }}` |
| `SparePartRawDataPage.tsx` | 없음(Export 버튼만 존재) | 변경 없음 |
| `TaskManagementRawDataPage.tsx` | 없음(admin 링크만) | 변경 없음 |

Export 버튼/다이얼로그(각 Raw Data 내부)는 그대로 유지.

## 미변경 항목
- 각 Raw Data 페이지의 `ExportDialog`, `AbdExportDialog` 및 export 로직.
- 각 모듈의 Import 컴포넌트 내부 파싱/저장 로직.
- Aconex Sync(`closure/spare-part/aconex-sync`).
- Admin 관련 페이지.

## 기술 세부 사항

- 탭 상태 동기화:
  ```ts
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  <Tabs value={tab ?? "task"} onValueChange={(v) => navigate({ search: { tab: v } })}>
  ```
- `validateSearch`: 리터럴 유니온 파서, 기본값 `"task"`.
- 리다이렉트 라우트는 `component` 없이 `beforeLoad`에서 `throw redirect(...)`.
- `src/routeTree.gen.ts`는 플러그인이 재생성 — 직접 편집하지 않음.

## 검증
- `bunx tsgo --noEmit` 통과.
- 사이드바 새 섹션 노출(editor/admin) 및 이동 확인.
- 각 탭 전환이 URL `?tab=` 파라미터에 반영.
- ABD/Snag Raw Data의 Import 바로가기가 새 통합 페이지 해당 탭으로 진입.
- 기존 URL(`/closure/abd/import` 등)이 새 라우트로 리다이렉트.
