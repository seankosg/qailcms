## 원인 분석

화면의 "This page didn't load" 화면은 `src/routes/__root.tsx`의 `ErrorComponent`가 렌더된 결과입니다 (`src/lib/error-page.ts`의 SSR 500 페이지와는 별개). 즉 DMR 페이지로 이동하거나 필터를 바꾸는 순간 **클라이언트 측에서 컴포넌트가 throw** → TanStack Router의 루트 error boundary가 잡아 흰 화면을 표시 → "Try again"을 누르면 `router.invalidate() + reset()`로 재렌더돼 정상 복구되는 흐름과 정확히 일치합니다. 최초 1회만 발생한다는 증상도 이 패턴과 부합합니다.

Worker 로그를 확인한 결과 대상 라우트는 모두 `200`으로 응답하고 있어 서버 문제는 아니고, **라우트 전환 중 React 렌더에서 발생하는 예외**로 봐야 합니다. 현재 가장 유력한 후보는 다음 두 가지이고, 아직 실제 스택으로 확정한 상태는 아닙니다.

1. `src/components/resource/dmr/DmrRawDataPage.tsx:180`
   - `useSearch({ from: '/_authenticated/resource/dmr/raw-data' })`는 기본 `strict: true`. 라우트 전환이 완전히 확정되기 전 렌더 사이클(다른 페이지에서 이 페이지로 이동하는 첫 프레임)에서 `from`이 현재 match에 없으면 "Match ... not found" 예외가 발생할 수 있습니다.
2. `src/components/resource/dmr/DmrRawDataPage.tsx:179`
   - `useNavigate({ from: '/resource/dmr/raw-data' })`는 실제 라우트 ID(`/_authenticated/...`)와 문자열이 다릅니다. 대개 무해하지만 `search: (prev) => ({ ...prev, ... })` 패턴과 결합될 때 첫 렌더에서 예상치 못한 값이 되면서 zodValidator가 두 번째 렌더에 대해 예외를 던질 수 있습니다.

## 진행 순서

### Step 1 — 실제 예외 특정
`ErrorComponent`(`src/routes/__root.tsx`)의 `console.error(error)`가 이미 원본 Error를 그대로 남기므로, 사용자가 재현한 직후 브라우저 콘솔 로그를 다음 턴에 수집합니다. 그 스택 트레이스로 아래 후보 중 어느 것이 실제 원인인지 확정합니다. (본 계획 승인 시 함께 진행)

### Step 2 — 수정 (Step 1의 스택에 따라 하나 이상 적용)

A. `useSearch`/`useNavigate` `from` 정합성 정리
- `src/components/resource/dmr/DmrRawDataPage.tsx`
  - `useNavigate({ from: '/resource/dmr/raw-data' })` → `useNavigate()` (인자 제거).
  - `useSearch({ from: '/_authenticated/resource/dmr/raw-data' })`는 유지하되, 라우트 강결합 이슈가 확인되면 `Route.useSearch()` 패턴으로 교체하여 라우트 정의 파일과 컴포넌트 경계를 명확히 합니다.
  - `navigate({ to: '.', search: (prev) => ... })`의 `to: '.'`도 라우트 컨텍스트가 아직 확정 안 된 시점에 문제가 될 수 있어, `to: '/resource/dmr/raw-data'`로 절대경로 지정으로 바꿉니다.

B. 전환 중 렌더 예외 방어
- 실제 원인이 A로 완전히 해소되지 않으면, DMR Raw Data / Dashboard 컴포넌트에 라우트 단위 `errorComponent`/`pendingComponent`를 추가해 루트 부메랑까지 튀지 않도록 합니다.
  - `src/routes/_authenticated/resource/dmr/raw-data.tsx`
  - `src/routes/_authenticated/resource/dmr/dashboard.tsx`
  - 각각 브랜드된 소형 fallback(현재 루트 스타일과 동일)과 재시도 버튼 제공.

C. Dashboard 페이지의 파생 상태 안정화 (원인 후보라면)
- `src/components/resource/dmr/DmrDashboardPage.tsx`
  - `useEffect`로 selection을 pruning 하는 두 구간(`workDescriptions` / `subContractors`)이 옵션 배열의 새 참조 때문에 매 렌더마다 다시 도는 것을 방지하기 위해, 옵션 비교를 `join(',')` 기준으로 축약 dependency로 바꿉니다. (예외 자체는 아니지만 렌더 폭주로 인한 간접 원인 가능성 차단)

### Step 3 — 검증
- 도전 케이스 3가지 시나리오로 Playwright 재현
  1. `/closure/spare-part/raw-data` → 사이드바에서 `DMR Raw Data` 클릭 (최초 진입)
  2. DMR Raw Data 페이지에서 페이지네이션 `»` 클릭 (검색 파라미터 변경)
  3. DMR Dashboard에서 `7d/14d/30d` 토글 클릭
- 각 케이스에서 흰 화면 → 정상 복구 패턴이 사라지고 곧바로 로딩 스켈레톤이 뜨는지 확인.

## 리스크와 롤백

- 변경은 DMR 관련 3개 파일에 국한되며 데이터 로직/스키마는 손대지 않습니다.
- 라우트 파일에 `errorComponent`가 추가되면 예외가 루트까지 전파되지 않아, 향후 문제 발견이 어려워질 수 있으므로 `console.error(error)`와 `reportLovableError`를 함께 호출해 관측성을 유지합니다.
- 문제가 재현되지 않으면 Step 2-A만 반영하고 B/C는 보류합니다.

## 확인 요청

이 계획대로 진행해도 되겠습니까? 진행 승인 즉시:
1. DMR Raw Data / Dashboard 페이지에서 문제를 재현한 뒤 브라우저 콘솔의 붉은 스택 트레이스를 저에게 보여주시면 원인 특정이 훨씬 빨라집니다.
2. 스택 확보 전이라도 승인해주시면 Step 2-A(가장 확실한 후보)부터 선반영하고, Step 1 로그로 잔여 원인을 좁혀 나가겠습니다.