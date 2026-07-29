# ABD (As Built Drawing) 워크플로우

## 개요

ABD는 도면/도서를 Aconex를 통해 승인(A)받기까지의 다중 라운드 승인 프로세스입니다.
각 도서는 **최대 3라운드**를 거치며, 각 라운드는 4개의 스테이지를 순차적으로 진행합니다.

## 4-Stage 모델 (라운드당)

```text
Draft Start (DS) → Draft Finish (DF) → Submission (Sub) → DAR Response (Resp)
```

| 스테이지 | 필드 | 의미 |
|----------|------|------|
| Draft Start   | `r{n}_draft_start_plan/actual`   | 작도 착수 |
| Draft Finish  | `r{n}_draft_finish_plan/actual`  | 작도 완료 |
| Submission    | `r{n}_submission_plan/actual`    | Aconex 제출 |
| DAR Response  | `r{n}_dar_plan/actual`           | DAR 회신 수신 |

## 라운드 진행 규칙

- DAR Response 결과(`r{n}_response_result`)는 `A / B / C` 중 하나.
- `A` → **승인 완료**. 이후 라운드 불필요. `latest_status='A'`로 동기화.
- `B / C` → 다음 라운드(`R{n+1}`) DS/DF/Sub 계획 수립 필요.
  - 계획이 하나도 없으면 `needs_planning=true` 자동 세팅 (트리거 `abd_compute_derived`).
  - MWS "ABD Attention" Inbox의 **계획필요** 탭에 노출.
- `is_terminated=true` 또는 Aconex Status가 Cancelled/Terminated인 항목은 진도/알림에서 제외.

## Latest Status = 'A' 승인 특례

라운드 상태와 무관하게 `latest_status='A'`이면 즉시 Approval 처리.
대시보드 / Progress Matrix / MWS 모든 집계에서 승인 완료로 계산.

## Aconex 임포트

- 임포트 화면(`/closure/abd/import`) 상단 토글: **Import HDEC / Import Aconex**.
- **Import Aconex** 모드
  - 매핑은 `abd_import_presets`의 Aconex 프리셋 사용.
  - **`Document No`** 는 유니크 키이며 해제 불가.
  - 대상 필드는 파일 행마다 "컬럼 선택" 버튼으로 개별 지정.
  - Preview 단계에서 필드별 변경 예상 카운트 + 최대 200행 Before/After Diff 표시.
  - Apply 시 diff는 `import_field_logs(kind='abd', reason_code='aconex_sync'|'aconex_no_change')`에 기록.
- **Import HDEC** 모드: 전체 필드 프리셋. 유니크 키는 `id` 또는 `source_issue_no`.
- 자동 스케줄 없음. 사용자가 Aconex에서 XLSX Export → 업로드.

## UR Aging (Under Review Aging)

- Aconex 상태가 Submitted/Under Review 계열에 머문 기간.
- 임계값은 Admin > ABD Settings 팝오버에서 관리 (`abd_settings.ur_thresholds`).
- Raw Data `ur_aging_days` 컬럼 뱃지가 임계값에 따라 tone 변경 (info/warning/destructive).

## Terminated 처리

- `is_terminated=true`: 통계 / 대시보드 / MWS 카운트 제외.
- Raw Data 상단 **Excluded** 뱃지 클릭 시 필터 토글 → 제외 항목만 조회.

## MWS 딥링크

- MWS ABD 섹션에서 항목 클릭 → `AbdDetailSheet` 열림.
- Attention Inbox 항목 클릭 → `/closure/abd/raw-data?detail=<id>` 로 이동해 상세 시트 자동 오픈.
## 데이터 정합성 기록 (2026-07-29)

- **backfill 적용**: `abd_backfill_response_results(false)` 실행 — 61개 도면, 총 62개 스탬프(r1 61 · r2 1, 한 도면은 r1/r2 동시). `r*_response_source='backfill'`.
- **잔여 기준선**: `r1_dar_actual` 존재 & `r1_response_result` NULL = **432건**(그중 `r2_submission_actual` 존재 **268건**), r2 = 23건, r3 = 0건. 현 시점 미조치.
- **중복 도면 기록 확정**: Plot C Aconex 파일은 **파일 내 중복 1건**(3,124행 / unique 3,123)이 사실이며, "실측 중복 0건"은 **DB 측 abd_number 중복이 0건**이라는 별개 사실이었다. 파일 중복은 `pickNewer`(aconex_date_modified 최신 우선, 동률 시 updated_at 최신) 규칙으로 결정적으로 처리한다.
- **v_active 적용 시 1행 차이**: dry-run 예측(1→2: 1건)과 적용 결과의 1행 차이는 **추정**(스캔~UPDATE 사이 타 트리거 상태 변화)이며, 불변식 통과로 추적을 종료한다.
- **원본 파일 오타(사용자 조치 필요)**: HDEC Status 파일의 `9206-BP12C-HDEC-ABD-TL-P3-L03-75525Z` 는 접미사 `Z` 때문에 Aconex `…-75525` 와 영구 미매칭. 원본 수정 필요.

## 라운드 생애주기 확정 정의 (2026-07-29)

- **개시**: `r{n}_draft_start_actual`
- **진행**: `r{n}_draft_finish_actual` → `r{n}_submission_actual` (제출 후 심사 대기 = UR(n))
- **종결**: `r{n}_dar_actual` + `r{n}_response_result` 기록 시점 — **회신 도착이 라운드 종결**.
  - `A` → 문서 종결, 다음 라운드 없음
  - `B`/`C` → 라운드만 종결, 다음 라운드 개시
  - 회신 전 → 라운드 열림(UR(n))
- **예외 Terminated**: 회신 없는 합의 철회. 라운드 종결이 아니며 같은 라운드 재제출(RESUBMIT(n)).
  실적 필드 보존, **통계 포함**.
- `dar_actual` 은 있으나 `response_result` 가 없는 코호트(R1 432 · R2 23)는 **종결로 집계하되 결과 미상**으로 분류한다(삭제·추정 금지).

## Progress 집계 기준 — 실적 vs 잔여 (2026-07-29 정합화)

| 구분 | 기준 | 비고 |
|---|---|---|
| 실적(actual) | `r{n}_*_actual` 컬럼이 라운드를 **영구 결정** | `active_round`·`approved_round`·`*_plan` 완전 배제. `_round` 는 "어느 컬럼을 볼 것인가"이며 All = 3개 컬럼 UNION |
| 잔여/예정(plan·remaining) | 현재 라운드 = 정본 `abd_judge_v1(row, as_of)->>'active_round'` | 자체 계산 금지. remaining 모드에서만 승인 도면 제외 |

- `latest_status='A'`, `is_terminated=true` 항목의 **과거 실적은 소급 삭제하지 않는다**(Progress 는 `excluded=all`).
- 집계 대상 날짜 컬럼은 전부 `date` 타입이므로 UTC 경계 밀림 없음(표준시 Asia/Qatar).
- Matrix 와 S-Curve 는 동일 RPC(`abd_progress_cells_json` / `abd_progress_totals_json`)를 사용하므로 본 정정이 양쪽에 동시 적용된다.
- **회귀 기준(S-curve 단조성)**: 동일 구간 누계는 as-of 가 뒤로 갈수록 감소하지 않는다. 2026-07-20/24/28 실측 통과(SB 1,688 → 1,797 → 2,024).

## 지연 단일 귀속 원칙 (2026-07-29 확정)

- 스테이지(축1): `DS{n}`(Draft Start) → `DF{n}`(Draft Finish) → `SB{n}`(Submission) → `RS{n}`(Response by dar).
  `current_stage` = 활성 라운드에서 아직 완료되지 않은 가장 앞선 단계. 구 `UR{n}`/Ready-to-Submit 의미의 `RS{n}` 폐기.
- `primary_delay` (KPI 정본): `current_stage` 단계의 plan < today AND actual 없음일 때만 해당 단계 코드(`DS2` 등). **도면당 0 또는 1개.**
- `delay_bucket` (인지용): 계획일이 지난 모든 미이행 단계 배열(+ `NoPlan`). **KPI 집계 사용 금지** — 상세/툴팁 전용.
- `delay_late` (지연이행): actual > plan 인 단계 배열. 지연 카운트와 무관한 별도 지표.
- 불변식: ΣDS+DF+SB+RS 지연 카드 = `primary_delay` 보유 도면 수. NoPlan 은 계획 부재 알람으로 별도.
- `bucket_top` 은 Row1 카드 계약 유지를 위해 NS/DS/UR/Approved/RESUBMIT 어휘를 그대로 사용(RS 단계 → `UR`).
