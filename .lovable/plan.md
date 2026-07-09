# Lusail Tower Project CMS — T&C 모듈 1차 구축

SHAW PROJECT CMS의 T&C 모듈을 참조 구현으로 삼아, QAIL 프로젝트에 동일한 구조로 재구축합니다. 사용자 응답에 따라 React Router 스택 + Lovable Cloud 신규 백엔드로 진행합니다.

## 1. 브랜딩 · 기본 세팅
- 앱 이름: **Lusail Tower Project CMS**
- 기본 팀/서브콘트랙터 목록은 SHAW의 `src/types/enums.ts`를 이식 후 Lusail용으로 조정(초기값은 SHAW 그대로 두고 이후 관리자 페이지에서 수정 가능하도록)
- 루트 메타(title/description/og) Lusail Tower Project로 교체

## 2. 스택 재구성 (TanStack Start → React Router)
현재 QAIL은 TanStack Start 빈 템플릿입니다. SHAW와 완전히 동일한 구조로 맞추기 위해:

- `src/routes/`, `routeTree.gen.ts`, `router.tsx`, `start.ts`, `server.ts` 제거
- `react-router-dom` 설치, `src/main.tsx` + `src/App.tsx` 구조로 전환
- `vite.config.ts`에서 TanStack Start 플러그인 제거, 표준 React SPA 구성으로 정리
- `index.html` 생성(Vite 표준 진입점)
- shadcn/ui 세팅(SHAW의 `components.json`, `src/components/ui/*` 이식)
- Tailwind 설정을 SHAW 스타일(HSL 토큰 기반 `index.css` + `tailwind.config.ts`)로 전환

## 3. Lovable Cloud 활성화 및 스키마
Lovable Cloud를 새로 활성화한 뒤 T&C 모듈에 필요한 최소 스키마만 마이그레이션으로 생성합니다.

- `profiles` (id, email, full_name, role_default)
- `user_roles` (user_id, role) — SHAW 규격(RLS 안전한 `has_role()` SECURITY DEFINER 함수 포함)
- `subtests` — T&C의 핵심 테이블. SHAW `subtests` 컬럼(item_no, description, team, subcontractor_name, T1/T2/R1/R2S planned·actual 일자, is_active, status, comments 관련 참조 등)에서 T&C 모듈에서 실제 사용하는 컬럼만 이식
- `subtest_comments` (subtest 상세/댓글용)
- `import_logs` (T&C Import 로그)
- `header_mappings`, `custom_fields` (Import 매핑/사용자 필드) — 캐시 구조 SHAW 그대로
- `schedule_revisions` (스케줄 개정 이력)
- 각 테이블에 GRANT + RLS 정책 + `has_role` 기반 관리자 정책 세팅
- 시드 데이터 없음(사용자가 Import로 채움)

## 4. 인증 · 레이아웃 공통 뼈대
SHAW의 다음 파일을 이식/재구현:
- `contexts/AuthContext.tsx` (Supabase auth + role 캐시)
- `components/layout/AppLayout.tsx`, `AppSidebar.tsx`, `ProtectedRoute.tsx`, `RoleGuard.tsx`
- `pages/Login.tsx`, `pages/ChangePassword.tsx`
- 사이드바 메뉴는 이번 단계에서는 **T&C 그룹만** 노출(다른 모듈은 회색 처리/추후 추가)
- `hooks/useHeaderMappings.ts`, `hooks/useCustomFields.ts`, `lib/header-mappings-cache.ts`, `lib/custom-fields-cache.ts` 부트스트랩 포함

## 5. T&C 페이지 이식 (선택된 전체 범위)
`/tc/*` 라우트를 SHAW와 동일하게 구성합니다.

| 경로 | 컴포넌트 | 원본 |
|---|---|---|
| `/` | Redirect → `/tc/dashboard` | — |
| `/tc/dashboard` | `DashboardPage` | `pages/DashboardPage.tsx` |
| `/tc/progress` | `SchedulePage` | `pages/SchedulePage.tsx` |
| `/tc/schedule-revision` | `ScheduleRevisionPage` | `pages/ScheduleRevisionPage.tsx` |
| `/tc/raw-data` | `SubtestList` | `pages/SubtestList.tsx` |
| `/subtests/:id` | `SubtestDetail` | `pages/SubtestDetail.tsx` |
| `/tc/import` | `ImportPage` | `pages/ImportPage.tsx` |
| `/tc/import/logs` | `ImportLogsPage` | `pages/ImportLogsPage.tsx` |
| `/tc/export` | `ExportPage` | `pages/ExportPage.tsx` |
| `/tc/quick-update` | `MobileUpdatePage` | `pages/MobileUpdatePage.tsx` |
| `/tc/simulation` | `TncSimulationPage` | `pages/TncSimulationPage.tsx` |

각 페이지가 참조하는 T&C 전용 lib 파일도 함께 이식:
- `lib/dashboard-utils.ts`, `lib/schedule-utils.ts`, `lib/schedule-cache.ts`
- `lib/schedule-change-utils.ts`, `lib/schedule-excel-export.ts`
- `lib/subtest-cache.ts`, `lib/subtest-population.ts`
- `lib/import-parser.ts`, `lib/import-field-log.ts`, `lib/header-mappings-cache.ts`, `lib/custom-fields-cache.ts`
- `lib/excel-export.ts`, `lib/excel-date-cell.ts`, `lib/fetch-all-rows.ts`
- `lib/tnc-simulation.ts`, `lib/tnc-raw-data-guide.ts`, `lib/stage-metrics.ts`
- `lib/business-days.ts`, `lib/date-normalize.ts`, `lib/item-no-sort.ts`, `lib/format.ts`, `lib/utils.ts`, `lib/constants.ts`
- `lib/comment-threads.ts`, `lib/comment-author-roles.ts` (Subtest Detail 댓글 기능)
- `lib/bulk-actions.ts`, `lib/bulk-edit.ts` (raw-data 대량편집)
- `lib/master-name-match.ts`, `lib/subcontractor-master-sync.ts`
- `contexts/ImportContext.tsx`

관련 컴포넌트 디렉터리 이식: `components/dashboard/`, `components/schedule/`, `components/raw-data/`, `components/comments/`, `components/simulation/`, `components/import/`, `components/shared/`, `components/ui/` 전부.

## 6. 관리자 최소 페이지
T&C가 참조하는 관리 기능만 포함:
- `/admin` (사용자·역할 관리) — `pages/AdminPage.tsx` 축약 버전
- Header Mappings / Custom Fields 관리 화면(Import 페이지에서 요구됨)

다른 모듈용 관리 화면(Classification, Report 등)은 이번 범위에서 제외.

## 7. 검증
- `bun install`, 빌드 통과 확인
- 로그인 → 대시보드 진입 → Import로 subtest 샘플 업로드 → Raw Data 목록·상세·Progress·Simulation·Export까지 왕복 동작 확인
- Playwright로 핵심 플로우 스크린샷 캡처

## 범위 제외 (2차 이후)
- Defects, Punch, Docs, DDN, Analysis(DMR) 모듈 전체
- 사진 OCR, PPT/Report Builder, Design Guide, Slide 관련 시스템

## 기술 세부 사항
- `App.tsx`는 SHAW의 라우팅 구조를 기반으로, 이번 범위에서 필요 없는 라우트/Provider(DefectImport, PhotoOcr, DocsImport 등)는 제거
- 마이그레이션 파일명은 Lovable Cloud 규칙에 따라 새 타임스탬프로 발행
- SHAW의 `subtests` 실제 컬럼 목록은 관련 마이그레이션과 `dashboard-utils.ts`의 `SubtestForDashboard` 타입을 읽어 정확히 이식
- 모든 `public.<table>`에 `GRANT` 명시(anon은 필요한 곳만), RLS + `has_role` 정책 필수
