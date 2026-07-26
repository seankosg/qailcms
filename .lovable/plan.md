# ABD 대시보드 — TM 3종 차트 이식

## 목표
ABD 대시보드 KPI(Row1/Row2) 바로 아래 새 row에 TM 대시보드의 3종 차트(Status Mix, 자동 판정 분포, 스테이지별 판정 스택)를 UI/디자인 그대로 이식하고, ABD 데이터 모델에 맞춰 로직만 재정의한다.

## 이식 로직 매핑 (사용자 확정)

| 차트 | TM 원본 | ABD 이식 정의 |
|---|---|---|
| **Status Mix** | Completed / WIP / No Start (3분할) | **4분할: Approved / UR / DS / NS** (`current_stage` 기준) |
| **자동 판정 분포** | 완료/정상/주의/지연/위험 (Plan% vs Actual%) | 완료=Approved · 정상=NS/DS 또는 UR<warn · 주의=UR≥warn · 지연=UR≥late · 위험=UR≥late×2 (임계값은 `abd_settings.ur_aging_warn_days`/`ur_aging_late_days`) |
| **스테이지별 판정 스택** | Start/WIP/Finish 3행 × 판정 스택 | **4행: NS · DS · UR · Approved** × 판정 스택 |

**공통 조건**: `is_terminated=false`(Excluded CX/TM 제외), 상단 Batch 필터(`batchFilter`) 반영.

## 산출물

### 1) 신규 RPC `abd_dashboard_judgment_mix`
- 입력: `_batch_no text[]`
- 출력: `stage`, `total`, `approved`, `normal`, `caution`, `delayed`, `critical` (스테이지 4행)
- 내부: `abd_items_raw`에서 `is_terminated=false` + batch 필터 → `current_stage` 그룹핑, `ur_aging_days`와 `abd_settings` 임계값으로 판정 카테고리 산출.
- 마이그레이션 파일에서 `GRANT EXECUTE TO authenticated, service_role`.

### 2) 컴포넌트 3종 (`src/components/abd/dashboard/`)
- `AbdStatusMixDonut.tsx` — TM `StatusMixDonut.tsx` 그대로 복제, 세그먼트만 4개(Approved/UR/DS/NS)로 확장. 색상: Approved=`--schedule-actual`, UR=`--warning`, DS=`--schedule-plan`, NS=`hsl(var(--muted-foreground))`.
- `AbdJudgmentDonut.tsx` — TM `JudgmentDonut.tsx` 그대로 복제. 데이터만 신규 RPC 결과에서 합산.
- `AbdJudgmentStageBreakdown.tsx` — TM `JudgmentStageBreakdown.tsx` 그대로 복제. `stage` 라벨은 NS/DS/UR/Approved 4행, compact 모드 지원.

세 컴포넌트 모두 카드 스타일·타이포·컨테이너 쿼리·툴팁·범례를 원본과 100% 동일하게 유지(원본 파일 복제 후 데이터 어댑터만 교체).

### 3) 공통 쿼리 훅 `useAbdJudgmentMix(batchNo)` (`src/lib/abd/dashboard.functions.ts`)
- `createServerFn` 래퍼 + `requireSupabaseAuth`로 신규 RPC 호출.
- React Query 키: `["abd-dash-judgment-mix", batchNo]`, `staleTime: 60_000`.
- `AbdDashboardPage`의 `refetch()`에 해당 쿼리 무효화 추가.

### 4) `AbdDashboardPage.tsx` 배치
Row2 아래, Row3(Status Dist) 위에 3-컬럼 그리드 삽입:
```text
[ AbdStatusMixDonut ] [ AbdJudgmentDonut ] [ AbdJudgmentStageBreakdown compact ]
```
- `xl:grid-cols-3`, 모바일 1열.
- 클릭 시 Raw Data 이동은 이번 범위 밖(추후 요청 시 딥링크 추가).

## 파일 변경 목록
- 신규: `supabase/migrations/<timestamp>_abd_judgment_mix_rpc.sql`
- 신규: `src/components/abd/dashboard/AbdStatusMixDonut.tsx`
- 신규: `src/components/abd/dashboard/AbdJudgmentDonut.tsx`
- 신규: `src/components/abd/dashboard/AbdJudgmentStageBreakdown.tsx`
- 수정: `src/lib/abd/dashboard.functions.ts` — 신규 서버 함수 추가
- 수정: `src/components/abd/dashboard/AbdDashboardPage.tsx` — 새 row 삽입 + refetch 키 추가

## 검증
- `tsgo --noEmit` 통과
- Supabase 마이그레이션 적용 후 대시보드에서 3종 카드 렌더/숫자 합계 = KPI Row1 Total과 일치(제외분 제외 기준)
