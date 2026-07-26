
## 왜 갑자기 어긋났나 (회귀 원인)

정합성 축이 세 곳에서 조금씩 추가되었는데 **수신부(Raw Data)** 만 함께 갱신되지 않아 누적된 격차가 이번에 드러났습니다. 커밋 이력으로 확인.

- **2026-07-20 (`722b7d17`)**: Raw Data 라우트에 `validateSearch` 스키마 도입 — 이때 필드는 `source/mode/asOf/team/hdec_pic_name/hdec_eng_name/discipline` 만 정의. 이후 스키마에 없는 URL 파라미터는 조용히 버려짐.
- **2026-07-23 (`106a18a9`)**: `TmDashboardPage` 에 Task 스코프(`taskScope`) 토글 및 `plot` 오너 필터 확장 도입. Dashboard KPI 계산 base 가 좁아짐.
- **2026-07-24 (`5b871c70`)**: `TmKpiCards.goRaw` 가 `taskScope` 를 URL 에 실어 보내기 시작. 그러나 수신 스키마에 `taskScope` 가 없어 이 값은 라우터에 도착 즉시 소실되고, 그 결과 Raw Data 는 항상 `scope='all'` 로 폴백.
- 같은 시점의 `useTaskDashboardData` 는 `plot`, `q` 를 서버 쿼리에 적용해 KPI base 를 축소하지만, `goRaw` 는 이 두 축을 URL 로 넘기지 않음. 수신 스키마에도 없음.
- Delay 계열 KPI 딥링크 표시에서 이슈 Sub 를 컨텍스트로 함께 노출하는 `extraSubs` 로직(`TaskManagementRawDataPage.tsx:567-600`) 이 도입되었으나, 화면에는 그것이 "컨텍스트" 임을 알리는 표기가 없어 카드 숫자와 리스트 개수의 차이가 그대로 오해로 남음.

즉 **각 커밋은 단독으로는 유효했으나, 라우트 스키마 확장 · 링크 페이로드 확장 · Raw Data 수신 로직 확장이 서로 다른 시점에 부분적으로만 이루어지면서 표시 축(plot/q/taskScope)이 조용히 손실**되었고, 여기에 delay 컨텍스트 Sub 삽입이 겹쳐 편차가 커진 것입니다. 논리 자체가 파괴된 것은 아니고 필드 배선 유실입니다.

## 수정 계획 (선택안 반영: 컨텍스트 Sub 유지 + 명시 뱃지)

### A. 라우트 검색 스키마 확장 — `src/routes/_authenticated/closure/task-management/raw-data.tsx`
`searchSchema` 에 다음을 추가(전부 CSV 문자열, `fallback(z.string(), "").default("")`):
- `taskScope` — `all | main | sub` 는 컴포넌트 단에서 폴백 검증.
- `plot`
- `q`

### B. 링크 페이로드 확장 — `src/components/task-management/dashboard/TmKpiCards.tsx`
`Props` 에 `plots?: string[]`, `q?: string` 추가.
`goRaw` / `goRawWithTeam` 두 함수 모두에서 다음을 URL 에 실어보냄.
- `plot = plots.join(",")`
- `q = q`
- (기존) `team / hdec_pic_name / hdec_eng_name / discipline / taskScope / mode / asOf / source`

호출부 — `src/components/task-management/dashboard/TmDashboardPage.tsx` 의 `<TmKpiCards ... ownerContext={{…}}>` 에 `plots: search.plot`, `q: search.q` 추가.

### C. Raw Data 수신 로직 확장 — `TaskManagementRawDataPage.tsx` (l.336~383 대시보드 진입 useEffect)
- `push("plot", s.plot)` 을 `columnFilters` 에 추가.
- `setGlobalFilter(s.q)` / `setSearchInput(s.q)` 로 검색 문자열 반영(현행 `""` 리셋 라인을 대체).
- `taskScope` 는 스키마 확장 후 정상 도착 — `kpiMode.scope` 그대로 반영.

### D. 컨텍스트 Sub 유지 + 명시 뱃지 (선택안)
`kpiFilteredRows` 자체는 현행 유지(매칭 + 이슈 Sub). 대신 툴바에 뱃지 한 줄을 추가해 사용자가 오해하지 않도록:
- 카운트를 계산할 때 `matched.length`(KPI 카드 정의와 100% 일치)와 `extraSubs.length` 를 각각 반환하도록 `kpiFilteredRows` 결과 형태를 소폭 변경 → useMemo 반환값을 `{ rows, matchCount, contextCount }` 로 개편, 표에는 `rows` 사용, 뱃지에는 두 카운트 사용.
- 스티키 헤더 좌측에 뱃지 노출(예):
  - `KPI: In Delay · asOf 2026-07-26 · scope All`
  - `매치 342건 (카드 숫자와 동일)   ·   컨텍스트 Sub 87건 (하위 이슈 참고용)`
  - 오른쪽 끝에 `[컨텍스트 Sub 숨기기]` 토글(로컬 상태) 추가 — 클릭 시 매치만 노출 → 카드 숫자와 화면 리스트가 완전 일치하는지 눈으로 즉시 검증 가능.
- 뱃지는 KPI 딥링크 모드(`kpiMode !== null`) 일 때만 렌더.

### E. 방어 장치 — 축 배선 회귀를 조기 검출
- `TaskManagementRawDataPage` 에 dev 전용 `console.warn` 을 추가: `source=dashboard` 인데 `search` 에 정의되지 않은(스키마가 삼킨) 키가 존재하면 경고. 실제 검사는 dashboard 진입 훅 내부에서 `Object.keys(location.searchStr)` 파싱으로 수행.
- 이렇게 하면 다음에 또 새 필터 축이 dashboard 에 추가되고 스키마가 누락됐을 때 개발 중에 즉시 노출됨.

## 기술 세부

- CSV 직렬화 관례 유지: 팀/PIC/Eng 는 콤마 조인, 개별 값 내 콤마는 dashboard 필터 UI 상 발생하지 않음(고정 옵션).
- `EMPTY_TOKEN` 은 `goRawWithTeam` 에서만 단일 값으로 실어보내므로 CSV 조인 이슈 없음.
- 뱃지 카운트는 delay 계열이 아닌 모드(`completed / planned_started / actual_started / wip / not_started` 등) 에서는 `matched === rows` 이므로 자동으로 `컨텍스트 Sub 0건` 로 표기되어 어색하지 않게 처리.
- 이 변경은 서버 스키마/RPC/DB 변경 없음. 프런트 정합성 이슈만 수정.

## 확인 완료
사용자가 (대안) 컨텍스트 Sub 유지 + 명시 뱃지 를 선택함 — 위 D 로 반영.
