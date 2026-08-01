## 원칙 확정

**구성·인터랙션은 ALSMK와 동일 / 수치는 TM 정본.** 신규 계산식은 0줄이며, 차트는 기존 정본 산출물의 시각화 뷰일 뿐이다.

## 정본 매핑 (별도 계산 금지 준수)

| 차트 요소 | ALSMK 원본 방식 | 채택할 TM 정본 |
|---|---|---|
| Plan% 막대 | 컴포넌트 내 선형 달력 즉석 계산 | `computeOwnerLeaderboard(...).planPct` (내부적으로 `cumPlanProgress`, Main은 가중 계획 체계) |
| Actual% 막대 | `current_progress` 평균 | `computeOwnerLeaderboard(...).actualPct` (`cumActualProgress`) |
| Gap / 색상 | 자체 gap 임계 | `.diffPp` |
| 지연 배지·건수 | 자체 `issue_flag` | `computeJudgment` 기반 `.delayedTasks` / `delayedTaskIds` |
| 임계값 | 하드코딩 | `useTaskManagementSettings()` → `thresholds` |
| As-of 반영 | 없음 | 상단에서 이미 재판정된 `scopedItems` + `asOfDate` 주입 |

즉 차트 수치는 **Owner Leaderboard 표와 행 단위로 완전히 동일**하다.

## 추가 UI — TM Dashboard 최하단 카드 1개

```text
┌ Progress by Owner ──────────────── [ Team | Individual ] ┐
│ Planned vs Actual — 막대 클릭 시 드릴다운                │
│   ■ Plan  ■ Actual     (그룹당 2개 막대, 상위 15)        │
└──────────────────────────────────────────────────────────┘
```

- 토글: `Team`(Building2) / `Individual`(Users) — ALSMK와 동일한 ToggleGroup 구성. 값은 기존 URL 파라미터 `ownerDim`(`team` ↔ `hdec_pic_name`)에 연결.
- 카드 타이틀·서브텍스트도 토글 연동(`Team Progress` ↔ `Individual Progress`).
- 막대 클릭 → **기존 `OwnerDetailDialog`** 재사용(신규 드릴다운 다이얼로그 만들지 않음). ALSMK의 인라인 드릴다운 패널 대신 앱 내 기존 패턴 유지.
- 정렬: `diffPp` 오름차순(가장 뒤처진 그룹 좌측) — Leaderboard와 동일 정렬.

## 기술 상세

**신규 1개** — `src/components/task-management/dashboard/OwnerProgressChart.tsx`
- props: `items`, `asOfDate`, `thresholds`, `dim`, `onDimChange`, `onOwnerClick`
- 내부 로직: `computeOwnerLeaderboard()` 호출 결과를 recharts `BarChart`(Plan/Actual 2 시리즈)에 매핑. 툴팁에 `diffPp`, `delayedTasks`, `taskCount` 표기.
- 자체 데이터 페칭·자체 판정 없음.

**수정 1개** — `TmDashboardPage.tsx`
- `DelayTopTable` / `OwnerLeaderboardCard` 그리드 **아래**, `OwnerDetailDialog` 앞에 `<OwnerProgressChart>` 배치(페이지 최하단).
- `onOwnerClick`은 기존 `setOwnerDetail(...)` 그대로 전달.

DB·RPC·데이터 모델 변경 없음. 기존 카드/필터/문구/배치 변경 없음.

## 검증

1. 동일 필터에서 차트 막대값 ↔ Owner Leaderboard 표의 Plan%/Actual%/Gap **행 단위 완전 일치** 확인.
2. Team ↔ Individual 토글 시 태스크 합계가 상단 KPI 모집단과 일치.
3. 과거 As-of 선택 시 차트가 재판정된 `effectiveItems`를 따르는지 확인.
4. 막대 클릭 드릴다운 건수 = 표 클릭 드릴다운 건수 동일.
