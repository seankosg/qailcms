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