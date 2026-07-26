## 목표

Task Auto Judgement의 판정 체계를 새로 정의합니다.

- 등급 순서(나쁜순): **악화 > 지연 > 주의 > 정상 > 완료**
- 판정 로직을 "실제 지연 발생 여부(gap 부호)"를 중심으로 단순화
- Start 스테이지에 4종 세분 판정 도입
- 기존 '위험' → '악화' 로 내부 키·표시 라벨 모두 리네임

---

## 1. 새 판정 등급 정의

| 등급 | 정의 | 판정 소스 |
|---|---|---|
| **완료** | actual_progress ≥ 100% | 파생 |
| **정상** | gap ≥ caution_gap_buffer, 지연 없음 | 파생 |
| **주의** | 0 ≤ gap < caution_gap_buffer (지연 임박) | Admin 임계치 |
| **지연** | gap < 0 (계획보다 뒤짐) | 파생 |
| **악화** | gap < worsen_gap (심각한 지연) | Admin 임계치 |

원칙: **지연/정상 경계는 gap=0(파생), 주의·악화 경계만 Admin이 설정**.

---

## 2. Admin 임계치 재구성

기존 4종 → 신규 2종:

| 신규 키 | 기본값 | 의미 |
|---|---|---|
| `caution_gap_buffer` | +0.05 (+5%p) | 이 여유 이하로 좁혀지면 '주의' |
| `worsen_gap` | -0.15 (-15%p) | 이 값 미만이면 '악화' |

기존 `behind_warn_gap`, `behind_late_gap`, `slip_warn_days`, `slip_late_days` 컬럼은 마이그레이션에서 DROP.

Admin 페이지(`/admin/task-thresholds`)의 입력 4개 → 2개, 미리보기 카운트 배지도 5종(악화/지연/주의/정상/완료)로 갱신.

---

## 3. Start 스테이지 재정의 (4종)

Raw Data의 Start pip에 표시되는 세분 판정:

| Start 판정 | 조건 |
|---|---|
| **정상완료** | actual_start ≤ plan_start |
| **지연완료** | actual_start > plan_start |
| **지연진행** | actual_start 없음 AND plan_start ≤ asOf |
| **정상** | actual_start 없음 AND (plan_start 없음 OR plan_start > asOf) |

**통합 판정에 미치는 영향** (옵션 A 확정):
- 미착수 & **지연진행** → 통합 판정을 **'지연'** 으로 고정 (일수 관계없이 악화 승격 없음).
- **정상완료·지연완료**는 통합 판정에 영향 없음(WIP·Finish의 gap이 결정). 단 Start pip 색상으로 이력 시각화.

---

## 4. 통합 판정 로직

착수 이후 행(actual_start 있음 OR actual_progress > 0):

```
if actual_progress ≥ 100%              → 완료
gap = Actual% − Cum.Plan%
  gap  < worsen_gap        (-0.15)     → 악화
  gap  < 0                             → 지연
  gap  < caution_gap_buffer (+0.05)    → 주의
  else                                 → 정상
```

미착수 행:
- Start=지연진행 → **지연**
- 그 외 → **정상**

Finish 스테이지의 slip 일수 기반 판정은 폐기(gap이 이미 반영).

---

## 5. 지연 지속일수 (표시 전용)

`asOf − plan_end` (plan_end 초과 시점 기준, 실시간 계산). 판정에는 사용하지 않고 Raw Data pip 툴팁·상세 뷰에 "지연 N일차"로만 표시. 신규 컬럼·스냅샷 불필요.

---

## 6. '위험' → '악화' 리네임 (전역)

내부 키와 표시 라벨 모두 교체:
- 코드 상수: `"위험"` → `"악화"` (JUDGMENT_KEY_ORDER, worstJudgment, AUTO_JUDGMENT_COLORS, KPI 라벨 등)
- DB 값: `task_management_raw.auto_judgment`의 `'위험'` 문자열 일괄 UPDATE → `'악화'`
- `calc_auto_judgment_value` 함수 재작성 시 새 값만 반환

---

## 7. UI 반영

- **Raw Data pip 3종(Start/Alarm/Finish)**:
  - Start pip는 4종 스타일(정상완료·지연완료·지연진행·정상), 각각 색·글리프 지정.
  - Alarm pip는 5종(악화/지연/주의/정상/완료).
- **Dashboard**:
  - `AUTO_JUDGMENT_COLORS` 및 KPI 카드에 '악화' 반영(rose-700 계열).
  - Status Mix, Judgment Donut, 스테이지별 판정 스택 등 모든 시각화의 키 순서: 완료 · 정상 · 주의 · 지연 · 악화.
- **MWS/MTWS**: `computeJudgment` 재사용이므로 자동 반영. 필터 칩 라벨만 '위험'→'악화'.
- **Task Summary**: 위험도 필터 라벨을 '악화'로 교체.

---

## 8. DB 마이그레이션

1. `task_management_settings`
   - ADD `caution_gap_buffer numeric DEFAULT 0.05`
   - ADD `worsen_gap numeric DEFAULT -0.15`
   - DROP `behind_warn_gap`, `behind_late_gap`, `slip_warn_days`, `slip_late_days`
2. `calc_auto_judgment_value` 함수 §4 로직으로 재작성 ('악화' 반환).
3. `UPDATE task_management_raw SET auto_judgment = '악화' WHERE auto_judgment = '위험';`
4. `SELECT recalc_task_auto_judgment();` 로 전체 재계산.

---

## 9. 파일별 변경 요약

| 파일 | 변경 |
|---|---|
| `src/lib/task-management/derived.ts` | `TaskThresholds` 2필드로 재정의, `computeJudgment`·`getStageJudgment` 재작성, Start 4종 상수 export |
| `src/lib/task-management/delay-utils.ts` | `JUDGMENT_KEY_ORDER = [완료,정상,주의,지연,악화]`, worstJudgment 우선순위 갱신 |
| `src/lib/task-management/columns.ts` | `AUTO_JUDGMENT_COLORS`에 '악화' 추가, '위험' 제거 |
| `src/lib/task-management/kpi-utils.ts` | Critical Delay = '악화' 카운트, 라벨 갱신 |
| `src/components/task-management/raw-data/TaskStageProgress.tsx` | Start 4종 스타일·글리프·라벨, Alarm 5종 |
| `src/components/task-management/dashboard/*`, `JudgmentDonut`, `JudgmentStageBreakdown` | 색 팔레트/키 순서/라벨 교체 |
| `src/routes/_authenticated/admin/task-thresholds.tsx` | 입력 2개, 미리보기 5종 배지 |
| `src/lib/task-management/settings.functions.ts` | Zod 스키마 신규 2종 |
| `src/hooks/useTaskManagementSettings.ts` | 새 필드 로드, DEFAULT_THRESHOLDS 갱신 |
| `src/hooks/useMyWorkspaceData.ts` 및 MWS/MTWS/Task Summary | 필터 옵션 라벨 '위험'→'악화' |
| Supabase migration | §8 SQL 실행 |

---

## 10. 검증

- 임계값 저장 → 전체 재계산 후 대시보드 5종 카운트 확인.
- 샘플 행(예: gap=+0.02, gap=-0.03, gap=-0.20)이 각각 주의/지연/악화로 분류되는지 확인.
- Start 4종이 Raw Data pip에 올바른 색으로 표시되는지 스크린샷 확인.
- MWS의 필터 칩·Task Summary 위험도 필터에서 '악화' 라벨 노출 확인.
