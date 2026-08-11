# PDB 모듈별 필터 — Admin > Setting 페이지에서 세팅

## 목표
Project Dashboard(`/project-summary`)의 TM · SM · ABD 각 모듈 블록이,
Admin 에 새로 만드는 **Setting** 페이지에서 저장한 모듈별 필터를 그대로 읽어
KPI 카드와 S-Curve 차트에 동시 적용되게 한다. (같은 모듈 안에서 KPI·차트는 항상 같은 필터)

## 새 화면
`/admin/setting` — 상단 3탭(Task Management · Snag Management · As Built Drawing).
각 탭 안의 필터는 **탭형(Tabs / 토글 칩)** 으로 구성하며, 기존 각 모듈 KPI Analysis 화면의
필터 컴포넌트와 같은 형태를 쓴다. HDEC PIC · HDEC ENG 는 항상 ALL 이므로 **넣지 않는다.**

세팅 대상 필터(모듈별):

| 모듈 | 필터 |
|---|---|
| TM | Task Scope(Main/Sub) · Team(=discipline, 다중) · Work Type · Delay 필터 · Bucket(일/주/월) · **차트 시작일** |
| SM | Team(다중) · Room Group(다중) · Building(다중) · Stage · Plan Mode · Bucket · 단위(건수/%) · **차트 시작일** |
| ABD | Team(다중) · Plan Mode · Bucket · **차트 시작일** |

차트 **끝날짜는 PDB 우측 상단 기준일**을 그대로 쓰므로 세팅 대상이 아니다.
시작일은 날짜 입력으로 지정하고, 비워두면 현행 기본값(오늘 −14일)을 쓴다.

Plot(C/D)은 PDB 가 구조적으로 좌우 2열이므로 세팅 대상이 아니다(현행 유지).
저장/초기화 버튼, 마지막 수정자·시각 표시.

## 데이터 모델 (사전 승인 요청 항목)
신규 테이블 1개:

```
public.pdb_module_filters
  module      text primary key   -- 'tm' | 'sm' | 'abd'
  filters     jsonb not null default '{}'::jsonb
  updated_at  timestamptz not null default now()
  updated_by  uuid
```
- GRANT: `select` → authenticated, `all` → service_role
- RLS: 읽기 = 로그인 사용자 전체, 쓰기 = 관리자(기존 admin 판정 함수 사용)
- 마이그레이션에 tm/sm/abd 3행 기본값 INSERT 포함(현재 PDB 하드코딩 값과 동일하게 시드
  → 적용 직후 화면 수치가 변하지 않는다)

## 연동 방식
- `useProjectDashboardFilters()` 훅 신설 — 3행을 한 번 조회해 모듈별 필터 객체 반환.
- `TmDashboardSection` / `SmDashboardSection` / `AbdDashboardSection` 은 지금 하드코딩된
  훅 인자(`teams: []`, `bucket: "week"`, `taskScope: "sub"` 등)를 이 값으로 대체.
  계산식·훅·카드 컴포넌트는 **변경하지 않는다**(정본 유지).
- **PDB 차트 안의 조작 UI(Bucket · 단위 토글)는 제거한다.** 세 카드에 선택적 prop
  `controlsHidden` 을 추가해 PDB 에서만 숨기고, 원래 KPI Analysis / Progress 화면은 그대로 둔다.
- 대신 각 모듈 블록 상단에 **세팅 페이지에서 설정된 필터 현황**을 칩으로 표시한다
  (Team · Room Group · Stage · Work Type · Bucket · 시작일 등). 칩 옆에
  "Admin > Setting 에서 변경" 링크를 둔다.
- 세 훅(`useTmScurveData` · `useSnagScurveData` · `useAbdScurveData`)에 선택적
  `startDate` 인자를 추가한다. 값이 없으면 지금과 동일한 `오늘 −14일` 이라
  기존 KPI Analysis / Progress 화면 수치는 변하지 않는다.

## 기술 메모
- 조회는 `createServerFn` 없이 생성된 supabase 클라이언트로 읽기(공개 읽기 아님, 로그인 필요).
- 저장은 관리자 전용 서버 함수 `savePdbModuleFilters`(`.middleware([requireSupabaseAuth])`).
- Admin 개요 카드와 사이드바 Admin 하위에 "Setting" 진입점 추가.
