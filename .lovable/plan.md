## 목표
Task Tree 상단의 위험도 필터(정상/주의/지연/위험)를 P.Finish 없음 배지 오른쪽으로 이동시키고, 각 버튼에 해당 판정에 속하는 태스크 갯수를 표시.

## 변경 파일
- `src/components/task-management/tree/TaskTreePage.tsx`

## 상세 변경 사항

1) 판정별 카운트 계산 (`missingPlanCounts` 옆에 새 useMemo 추가)
- 대상: 현재 `discipline`으로 fetch된 `data` 전체(Main + Sub), 현재 `picFilter` 조건과 동일 규칙으로 필터링. `missingPlanCounts`와 동일 스코프 유지.
- 각 행에 대해 `resolveJudgment(r, asOfDate)` 결과를 집계 → `{ 정상, 주의, 지연, 위험 }` map 생성.
- Data Date 및 PIC 필터 변경 시 자동 재계산 (deps: `data`, `picFilter`, `asOfDate`).

2) 필터 UI 위치 이동
- 기존 위치(line 452~488, 상단 ml-auto 영역)의 위험도 버튼 그룹 + "해제" 버튼을 제거.
- P.Start/P.Finish 없음 버튼이 있는 두 번째 줄(line 520~555)의 P.Finish 없음 버튼 바로 오른쪽에 배치.
- 상단 우측 영역에는 검색/펴기/접기/Excel 버튼만 남김(ml-auto 유지).

3) 버튼 표시
- 기존 pill 스타일 유지(`rounded-full border px-2.5 text-[11px]`, active 시 `AUTO_JUDGMENT_COLORS[j]` + ring).
- 라벨 오른쪽에 갯수 표시: `<span className="tabular-nums font-semibold">{count.toLocaleString()}</span>` (P.Start/P.Finish 없음 배지와 동일한 스타일 규칙).
- 갯수가 0이어도 클릭 가능(필터 토글은 유지) — disabled 처리 안 함.
- "해제" 링크는 그대로 유지, 위험도 버튼 그룹 끝에 배치.

## 로직/데이터 영향 없음
- 필터 판정 로직(`resolveJudgment`), 검색, 라우팅, sessionStorage 저장 항목(`judgmentFilter`)은 그대로. UI 위치와 카운트 표시만 변경.
