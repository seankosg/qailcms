# ABD Dashboard — Termination 후 재제출 건이 "Resubmit by TM"에서 빠지지 않는 문제

## 실측 확인 결과 (조사 완료)

원인은 대시보드 화면이 아니라 **`is_terminated` 플래그가 한 번 켜지면 절대 꺼지지 않는 것**입니다.

- 판정 정본 `public.abd_judge_v1` 은 승인(A) 판정 다음에 `IF COALESCE(_row.is_terminated,false) THEN ... bucket_top='RESUBMIT'` 로 **무조건** RESUBMIT 을 반환합니다. 재제출 실적일이 있어도 예외가 없습니다.
- 임포트 `src/lib/abd/aconex-import.functions.ts:547-551` 은 Terminated 이벤트에서 `is_terminated = true` 만 기록하고, 이후 재제출·회신 이벤트에서 이 플래그를 **되돌리는 코드가 없습니다**.
- 현재 데이터(`abd_items_raw`, `is_terminated = true` 644건)의 최신 Aconex 상태 분포:

```text
For Review / Terminated              319   (정상: 아직 재제출 안 됨)
For Review / Under Workflow Review   230   (재제출됨 → 지금도 Resubmit 로 집계)
A - Approved / Approved               72   (승인 분기가 먼저라 Approved 로 정상 집계)
C - Revise and Resubmit / Revise&Re-Submit  23   (재제출 후 반려 → 지금도 Resubmit 로 집계)
```

- 현재 버킷 집계: Approved 4,870 / DS 920 / **RESUBMIT 564** / UR 302 / CANCELLED 3.
  RESUBMIT 564 중 **약 253건(230 + 23)** 이 이미 재제출된 건으로, 빠져야 할 물량입니다.

## 수정 방향 (권장안)

플래그를 "종결 이벤트가 최신일 때만 참"이 되도록 임포트에서 관리합니다. 판정 함수 `abd_judge_v1` 과 대시보드 UI 는 손대지 않습니다(라운드·버킷 산식 불변).

1. **임포트 교정** — `computePatch()` 에서 Terminated/Cancelled 가 아닌 이벤트(SUBMITTED, DAR_APPROVED_A/B, DAR_REJECTED)를 반영할 때, 그 이벤트의 `date_modified` 가 기존 행의 `aconex_date_modified` 이상이면 `patch.is_terminated = false` 를 함께 기록. 즉 종결 이후 더 새로운 사건이 오면 종결 해제.
   - 역순(과거 이벤트가 뒤늦게 들어오는 경우)에는 플래그를 건드리지 않습니다.
   - `is_terminated` 가 임포트 프리셋의 허용 컬럼(`allowed`)에 있을 때만 기록하는 기존 규칙을 그대로 따릅니다.
   - Cancelled(`is_active=false`)는 성격이 달라 이번 변경 범위 밖입니다.

2. **기존 데이터 1회 보정 (멱등 마이그레이션)** — 최신 Aconex 리뷰 상태가 Terminated 가 아닌 행의 `is_terminated` 를 false 로 되돌립니다.

```sql
update public.abd_items_raw
   set is_terminated = false
 where is_terminated
   and upper(coalesce(aconex_review_status_raw,'')) not like '%TERMINAT%';
```

   시행 전 대상 건수를 세어 보고하고, 시행 후 버킷 재집계(RESUBMIT 564 → 약 311)를 실측 보고합니다.

3. **검증** — 대시보드 Row1 6분류 등식(Approved + UR + DS + Resubmit + Cancelled = Total)이 보정 후에도 성립하는지, Raw Data 의 `Resubmit by TM` 필터 건수와 대시보드 카드 수치가 일치하는지 대조.

## 확인이 필요한 판단 1건

재제출 판정 근거를 **"Aconex 최신 이벤트가 Terminated 가 아니면 해제"** 로 잡았습니다(위 1·2번). 대안으로 **"종결 이후 새 제출 실적일(`r*_submission_actual`)이 기록되면 해제"** 기준도 가능하지만, 현재 스키마에 종결 시각 컬럼이 없어 날짜 비교가 불가능하고 `terminated_at` 컬럼 신설이 필요합니다. 최신 이벤트 기준으로 진행해도 되는지 확인 부탁드립니다.

## 변경 대상 파일

- `src/lib/abd/aconex-import.functions.ts` — Terminated 해제 조건 추가
- 신규 마이그레이션 1건 — 기존 253건 보정 (스키마 변경 없음, `abd_judge_v1` 미변경)
