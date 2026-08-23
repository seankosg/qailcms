# ABD Termination 후 재제출 `Resubmit by TM` 오집계 교정 — Stage 1

지시서를 그대로 채택합니다. Stage 1(코드 교정 + 읽기 전용 Dry-run)만 수행하고 정지합니다. Stage 2(데이터 보정 migration)는 승인 후 별도 진행합니다.

## 이미 실측으로 확인된 전제

| 항목 | 실측 결과 |
|---|---|
| `aconex_date_modified` 타입 | `date` (시각 없음) → 같은 날 상충 사건이 실재 가능 |
| `abd_bucket_of` | `is_active` false → CANCELLED, 이후 Approved/UR/DS, **ELSE → RESUBMIT (catch-all)** |
| Terminated 해제 코드 | 부재. `computePatch()`는 `EXCLUDED_TERMINATED`에서 `true` 설정만 수행 |
| Cancelled 처리 | `is_active=false` + `inactive_reason='aconex_cancelled'` (별도 축) |
| `is_terminated=true` | 644행 / 전체 6,659행, 모두 `is_active=true`, 날짜 누락 0 |

`is_terminated=true` 상태 조합(4종 전부):

```text
For Review              / Terminated              319
For Review              / Under Workflow Review   230
A - Approved            / Approved                 72
C - Revise and Resubmit / Revise & Re-Submit       23
```

NULL·공란·UNKNOWN·D-code·Cancelled 조합은 **0건**. 보정 후보 = 325행(잠정, Dry-run에서 재확정).

## Stage 1 작업 항목

### 1. 인벤토리 완결 (읽기 전용)
- Row1 정본 수치(Total/Approved/UR/DS/Resubmit/Cancelled)와 Raw Data `Resubmit by TM` 필터 건수 대조
- 동일 ABD + 동일 `aconex_date_modified` 중복·상충 사건 조사 (현재 저장 데이터 및 `pickNewer()` 영향 범위)
- 조합별 실제 저장 문자열 그대로 보고

### 2. `aconex-import.functions.ts` 교정

**배치 결정론 (§3.1)** — 현재 `pickNewer()`는 문자열 비교로 동일 날짜 시 먼저 나온 행을 유지(순서 의존). 다음으로 교체:
1. 날짜 상이 → 최신 행
2. 동일 날짜 + 동일 semantic → 결정론적 축약
3. 동일 날짜 + 상충 semantic → 해당 ABD Number를 **blocker**로 분리, 자동 우선순위 부여 금지

**해제 전환 (§3.2–3.3)** — `computePatch()`에 조건부 `patch.is_terminated = false` 추가.
- 허용 semantic: `SUBMITTED` / `DAR_APPROVED_A` / `DAR_APPROVED_B` / `DAR_REJECTED`(D-code 제외)
- 전제: `existing.is_terminated === true`, `existing.is_active !== false`, `allowed.has('is_terminated')`
- 입력일 > 기존일 → 해제 / 입력일 = 기존일 → 배치에서 단일 semantic으로 확정된 경우에만 해제 / 입력일 < 기존일 → 유지 / 날짜 없음 → 유지 + 구조화 warning
- `computePatch`가 배치 확정 결과를 참조해야 하므로 시그니처에 동일 날짜 판정 컨텍스트를 추가

**preset 누락 blocker (§3.4)** — 배치에 종결 설정/해제 사건이 있는데 `allowed`에 `is_terminated`가 없으면 `TERMINATION_FIELD_NOT_ALLOWED`로 차단(영향 행수·표본 ABD Number·필요 필드 포함). 기존 `true` 마킹 경로의 무언 스킵도 동일 게이트로 편입.

**감사 로그 (§3.5)** — 기존 field log/change log 경로 재사용. reason code `termination_cleared_by_newer_aconex_event`, 동일 날짜 해제 시 detail `same_date_unambiguous_transition`. 신규 테이블 없음.

### 3. Dry-run (SELECT 전용, UPDATE·migration 없음)
- 화이트리스트 조합 확정 후 후보 추출
- 각 후보의 composite row를 읽기 전용 복제하여 `is_terminated=false`만 가상 적용 → `abd_judge_v1` 호출 → 이동 버킷 분류
- 분리 보고: ① 플래그 후보 전체 ② 실제 Resubmit 감소 예상 ③ catch-all 잔류 ④ 이미 Approved라 무영향 ⑤ 제외군
- ABD Number 단위 상세표(현재 raw status/review status, 날짜, 현재 bucket, 가상 bucket, KPI 이동 여부, 포함 사유) 산출

### 4. 테스트 12건 + 타입검사
지시서 §5의 1~12번을 `computePatch()`/배치 정규화 단위 테스트로 추가하고, 타입검사만 실행. 운영 Import·전수 회귀 없음.

## 미변경 보장
Dashboard UI·`abd_dashboard_row1_json`·`abd_bucket_of`·`abd_judge_v1`·Progress 산식·기타 Raw Data 필터·기존 migration·기존 로그는 손대지 않습니다. Stage 1에서 운영 데이터 변경, migration 생성/적용, 배포는 수행하지 않습니다.

## 열린 확인 사항
지시서 §4.2의 화이트리스트에 **B 승인 조합**(`B - Approved with Comments` / `Approved with Comments`)은 현재 `is_terminated=true` 행에 0건입니다(테이블 전체에는 120행 존재). Dry-run 화이트리스트에는 실측 3조합만 넣고 B는 제외할 예정이며, 향후 B 유입은 §3의 임포트 전환이 semantic 기준으로 처리합니다.
