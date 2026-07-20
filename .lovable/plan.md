# TM 대시보드 KPI 카드 — 팀별 breakdown 표시 + 딥링크

## 목표
`RiskKpiCard`를 확장하여 In Delay / Start Delayed / Completion Overdue / Critical Delay / Behind Schedule 5개 카드 우측에 **팀별 세부 카운트**를 표시. 팀별 합계 = 카드 총합. 팀별 숫자 클릭 시 해당 mode + 해당 팀만 필터된 Raw Data로 이동.

## 스코프 및 규칙
- **집계 기준**: `TaskItem.team`. null/빈 값은 `"미지정"` 키로 묶음.
- **범위 일치**: 상단 Task Filter(Scope + Discipline) 적용 후의 `scoped` 배열만 사용해 카드 총합과 정확히 일치시킴.
- **정렬**: count 내림차순 → 팀명 오름차순.
- **표시 개수**: 카드당 팀 리스트 최대 6행, 초과 시 마지막 행에 `기타 (n팀) · <합계>` 요약. `기타`는 클릭 비활성.
- **`미지정`(team null/빈값)**: 정상 표시 및 클릭 가능(딥링크는 team 파라미터 대신 `teamNull=1` 플래그 사용).
- **레이아웃**: 카드 내부를 좌(라벨/수치/보조텍스트)/우(팀 리스트) 2컬럼 flex. 우측은 `min-w-[112px] max-w-[180px]`, 각 행 `h-5 text-[11px] tabular-nums flex justify-between`. 컨테이너 `max-h-24 overflow-y-auto`. 카드 폭이 좁을 때 자연스럽게 아래로 wrap.

## 딥링크 로직
- 팀 행 클릭 → `navigate('/closure/task-management/raw-data', { search })` 호출.
- search 구성 규칙:
  - 기본: `source=dashboard`, `mode=<모드>`, `asOf=<asOfDate>`, `taskScope=<현재 스코프>`.
  - **team**: 클릭된 팀 코드 **단일값**으로 override(대시보드에 이미 걸린 `ownerContext.team`과 무관하게 단일 팀만 적용).
  - `hdec_pic_name`, `hdec_eng_name`, `discipline`: 대시보드 컨텍스트 값 그대로 계승(사용자가 이미 좁혀둔 조건 유지).
  - 클릭 팀이 `미지정`이면 `team`을 비우고 `teamNull=1`을 추가.
- 카드 자체 onClick(전체 mode 이동)은 유지. 팀 행에는 `e.stopPropagation()`로 버블 차단.

## Raw Data 페이지의 team 필터 수용
- `src/routes/_authenticated/closure/task-management/raw-data.tsx` search schema에 `teamNull` 필드 추가(`fallback(z.string(), "").default("")`).
- `TaskManagementRawDataPage`가 `source=dashboard` 진입 시 필터를 리셋하고 다음을 적용:
  - `team` 검색 파라미터 → 팀 다중선택 필터에 단일 코드로 설정.
  - `teamNull=1` → 팀 컬럼이 NULL/빈값인 행만 필터(기존 `team` 파라미터와 상호 배타). 페이지 내부 필터에 `team IS NULL` 옵션이 없다면 프리셋 로직에서 특수 처리(`team=""` OR NULL 매칭).
  - 나머지 mode/asOf/taskScope/hdec_*·discipline 파라미터는 기존 대시보드 딥링크 규칙 그대로 적용.

## 구현 파일

### 1. `src/lib/task-management/kpi-utils.ts`
- `computeKpiBreakdownByTeam(rows, asOf, thresholds)` 신규 추가.
- 반환:
  ```ts
  {
    inDelay: Array<{ team: string; isNull: boolean; count: number }>;
    startDelayed: ...;
    completionOverdue: ...;
    criticalDelay: ...;
    behindSchedule: ...;
  }
  ```
- 팀 키 정규화: `String(row.team ?? '').trim()`; 빈문자열이면 `{ team: '미지정', isNull: true }`, 아니면 `{ team: code, isNull: false }`.
- 각 지표별 판정 함수는 기존 `isInDelay`, `isStartDelayed`, `isCompletionOverdue`, `isCriticalDelay`, `isBehindSchedule` 재사용.

### 2. `src/components/task-management/dashboard/RiskKpiCard.tsx`
- prop 추가: `breakdown?: Array<{ label: string; count: number; onClick?: () => void; disabled?: boolean }>`.
- CardContent를 flex row 2컬럼으로 변경. `breakdown` 미지정이면 기존 세로 레이아웃 유지(다른 페이지 호환).
- 각 행 렌더:
  - clickable: `<button>` + hover(bg-accent/40) + `stopPropagation` + `onClick` 호출.
  - disabled(기타 행): 비클릭 `<div>`, `text-muted-foreground`.
- 상단 6행 노출 후 초과분은 상위 컴포넌트에서 미리 합쳐서 전달(카드는 표시만 담당).

### 3. `src/components/task-management/dashboard/TmKpiCards.tsx`
- `scoped` 기반으로 `computeKpiBreakdownByTeam` 결과 `useMemo`.
- 헬퍼: `toBreakdownRows(list)` — 정렬 후 상위 6개 + 나머지 합산 `기타 (n팀)` 행 생성. 각 클릭 행의 `onClick`은 아래 `goRawWithTeam` 호출.
- `goRawWithTeam(mode, entry: { team, isNull })`:
  ```ts
  const s: Record<string,string> = { source: 'dashboard', mode, asOf: asOfDate, taskScope };
  if (entry.isNull) s.teamNull = '1'; else s.team = entry.team;
  if (ownerContext?.hdec_pic_name?.length) s.hdec_pic_name = ...;
  if (ownerContext?.hdec_eng_name?.length) s.hdec_eng_name = ...;
  if (ownerContext?.discipline?.length) s.discipline = ...;
  navigate({ to: '/closure/task-management/raw-data', search: s as any });
  ```
- 5개 카드에 `breakdown` prop 전달(In Delay / Start Delayed / Completion Overdue / Critical Delay / Behind Schedule).

### 4. `src/routes/_authenticated/closure/task-management/raw-data.tsx`
- searchSchema에 `teamNull: fallback(z.string(), "").default("")` 추가.

### 5. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- `source=dashboard` 초기 진입 로직에서:
  - `team` 파라미터 있으면 팀 필터를 그 단일값으로 세팅.
  - `teamNull==='1'`이면 팀 필터를 "미지정/NULL" 상태로 세팅(내부 필터 구조에 맞춰 특수 sentinel `__null__` 또는 별도 boolean 상태 추가).
  - 두 값이 모두 없으면 기존 동작 유지.

## 검증 체크리스트
- 팀별 count 합 === 각 지표 총합(카드 대형 숫자)과 일치. dev 콘솔에서 3개 지표 spot-check.
- 팀 행 클릭 → Raw Data가 해당 mode + 단일 팀 + (있으면) 기존 hdec/discipline만으로 필터되어 표시.
- `미지정` 클릭 → team이 NULL/빈값인 행만 표시.
- Task Filter Discipline 변경 시 breakdown이 즉시 재계산.
- 카드 자체 onClick은 여전히 전체 mode 이동으로 동작(팀 행 클릭 시 버블 차단 확인).

## 파일 편집 요약
- 편집: `src/lib/task-management/kpi-utils.ts`, `src/components/task-management/dashboard/RiskKpiCard.tsx`, `src/components/task-management/dashboard/TmKpiCards.tsx`, `src/routes/_authenticated/closure/task-management/raw-data.tsx`, `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- 신규/삭제 없음
