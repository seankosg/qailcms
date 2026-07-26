# TM 판정 로직 DB 단일 소스화 + Data Date 동적 계산 함수 신설

## 목표
- **정적 판정(기본 최신 Data Date)**: DB 트리거가 표준 로직으로 파생 컬럼을 계산·저장 → 모든 페이지는 컬럼을 그대로 조회만 함
- **동적 판정(사용자 Data Date 변경 시)**: DB 함수에 `p_data_date` 파라미터를 받아 즉석에서 재판정한 결과를 반환 → 클라이언트는 이 결과를 그대로 표시
- 두 경로 모두 **동일한 표준 판정 수식**을 공유하여 EL-C-12-06 같은 어긋남 재발 방지

## 표준 판정 수식 (단일 정의)
`task_management_raw` 한 행에 대해:

1. **Cum.Plan% 결정 (우선순위)**
   - `plan_progress`(엑셀 임포트 계획곡선) 값이 있고 유효하면 → 이를 사용
   - 없으면 → `elapsed / plan_days` 선형 계산 (fallback)
2. **Actual%**: `actual_progress` (0~1 클램프 완료된 값)
3. **Gap** = Actual% − Cum.Plan%
4. **Stage 판정**
   - Finish: actual=100% → 정상완료/지연완료
   - WIP: gap 기반 (관리자 임계값 `warn_gap`, `bad_gap` 적용)
   - Start: 미착수 slip일수 기반
5. **최종 auto_judgment**: `완료 / 정상 / 주의 / 지연 / 악화` 중 최악값

이 수식은 **DB PL/pgSQL 헬퍼 함수 1개**로 캡슐화하여 트리거와 동적 함수가 공유.

## 작업 항목

### 1. DB 표준 판정 헬퍼 함수 신설
- `public.tm_compute_judgment(row task_management_raw, p_data_date DATE) RETURNS jsonb`
  - 반환: `{cum_plan, cum_actual, gap, stage, auto_judgment, delay_days, alarm_reason}`
  - `plan_progress` 우선 사용 규칙 내장
  - `p_data_date` NULL이면 `CURRENT_DATE`(Asia/Qatar) 사용
  - 관리자 임계값(`task_management_settings`)을 함수 내부에서 조회

### 2. 기존 판정 함수/트리거 리팩터
- `calc_auto_judgment_value` → 위 헬퍼 호출로 교체 (elapsed/plan_days 로직 제거, plan_progress 우선)
- `recalc_task_auto_judgment` 트리거가 계산 결과의 각 필드를 파생 컬럼에 저장하도록 확장

### 3. 파생 컬럼 확장 (필요 시)
- `task_management_raw`에 없으면 추가: `cum_plan_pct NUMERIC`, `gap_pct NUMERIC`, `delay_days INT`, `alarm_reason TEXT`
- 기존 `auto_judgment`, `plan_progress`는 유지
- 트리거가 INSERT/UPDATE 시 자동 갱신
- 전체 행 1회 재계산 (마이그레이션 말미 `UPDATE ... SET updated_at = updated_at`)

### 4. 동적 재판정 RPC 신설
- `public.tm_judge_at_date(p_data_date DATE, p_task_ids UUID[] DEFAULT NULL) RETURNS TABLE(...)`
  - 지정 Data Date로 모든/일부 행을 재판정하여 반환
  - `p_data_date`가 NULL이거나 최신 Data Date와 같으면 저장된 파생 컬럼을 그대로 반환 (성능 최적화)
  - Dashboard/Task Summary/MWS/MTWS에서 사용

### 5. 클라이언트 판정 로직 제거·통일
- `src/lib/task-management/derived.ts`의 `computeJudgment` → **DB 결과를 그대로 사용하는 얇은 어댑터**로 축소 (로컬 재계산 금지)
- 각 페이지 훅:
  - Data Date = 최신(기본) → `select` 로 파생 컬럼 그대로 조회
  - Data Date ≠ 최신 → `tm_judge_at_date(p_data_date)` RPC 호출하여 결과 사용
- 영향 파일: `TaskManagementDashboardPage.tsx`, `TaskSummaryPage.tsx`, `MyWorkSpacePage.tsx`, `MyTeamWorkSpacePage.tsx`, `TaskDetailPage.tsx`, `useMyTasks.ts`, KPI/차트 유틸

### 6. Data Date 상태 통합
- Raw Data 페이지의 Data Date 선택기 제거 (요청대로 최신 고정)
- Dashboard의 Data Date를 `sessionStorage` 키 `tm_data_date`로 저장하는 훅 `useTmDataDate()` 신설
- 모든 TM 페이지가 이 훅을 구독 → 페이지 이동/복귀 시 값 유지

### 7. 검증
- EL-C-12-06: DB 컬럼 조회 결과와 상세 페이지 뱃지 및 표(FORECAST) 모두 **지연**으로 일치 확인
- Data Date를 과거로 바꿔도 Dashboard/Task Summary/MWS가 동일한 판정을 표시하는지 확인

## 기술 세부

```text
[임포트/입력] → 트리거 recalc_task_auto_judgment
                     ↓ (내부 호출)
              tm_compute_judgment(row, NULL)
                     ↓
           파생 컬럼 저장 (cum_plan_pct, gap_pct,
                    auto_judgment, delay_days, alarm_reason)

[조회 - 최신 Data Date]  → SELECT 파생 컬럼
[조회 - 임의 Data Date]  → RPC tm_judge_at_date(date)
                              → 각 행에 tm_compute_judgment(row, date) 실행
```

- 동일 헬퍼(`tm_compute_judgment`)를 트리거와 RPC가 공유하므로 로직 분기 없음
- 클라이언트는 계산을 **수행하지 않음**. 표시만 담당
- 관리자 임계값 변경 시: 기존 `resetAndRecompute` 경로 유지 → 트리거가 전체 행을 다시 저장

## 스코프 외
- ABD/SM/DMR은 이번 범위 아님 (TM만 대상)
- UI 디자인 변경 없음. 기존 뱃지/컬럼 그대로, 데이터 소스만 교체
