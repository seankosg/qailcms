# ABD Termination 재제출 오집계 — 보정 기준 확정

## 1. 4번 항목 재검토 결론

반대 의견이 옳습니다. Terminated 처리 시 `latest_status`와 `r*_submission_actual`을 보존하므로, 이 두 값은 **Termination 이전의 과거 상태일 수 있고 재제출을 증명하지 못합니다**. 제 기존 제안(정규화 컬럼 기준)은 철회하고, **현재 저장된 최신 Aconex 원문 조합 + 실측 화이트리스트** 방식을 채택합니다.

## 2. 실측 결과 (읽기 전용, 방금 조회)

`abd_items_raw` 전체 6,659행 / `is_terminated=true` 644행. 종결 플래그 행의 상태 조합은 정확히 4종뿐입니다.

| aconex_status_raw | aconex_review_status_raw | is_active | 행수 | 날짜 누락 |
|---|---|---|---|---|
| For Review | Terminated | true | 319 | 0 |
| For Review | Under Workflow Review | true | 230 | 0 |
| A - Approved | Approved | true | 72 | 0 |
| C - Revise and Resubmit | Revise & Re-Submit | true | 23 | 0 |

- NULL·공란·UNKNOWN 조합: **0건**
- `is_active=false` / Cancelled: **0건**
- `aconex_date_modified` 누락: **0건**
- 보정 후보 = 230 + 72 + 23 = **325행**

즉 반대 의견이 우려한 위험 조합은 이 데이터셋에 실재하지 않고, 화이트리스트 3종으로 완전히 덮입니다.

## 3. 그럼에도 남는 문제 3가지

### 3-1. "실측된 B 승인 조합"은 실측상 0건 — 추측 금지
종결 플래그 행 중 B 조합은 없습니다. 테이블 전체에는 `B - Approved with Comments` / `Approved with Comments`가 120행 존재하지만 모두 `is_terminated=false`입니다. 화이트리스트에 B를 **예비로 넣지 않습니다**(대상 0건이므로 무영향, 넣으면 미검증 규칙이 정본에 남음). 향후 B 유입은 3절의 임포트 교정이 semantic 기준으로 처리합니다.

### 3-2. 원문 조합도 "Termination 이후"라는 시점을 직접 증명하지는 못함
`is_terminated=true`가 기록된 시점을 저장하는 컬럼이 없어, `aconex_date_modified`가 종결 기록보다 뒤라는 것을 열 비교로 증명할 수 없습니다. 근거는 "현재 저장된 원문이 Terminated가 아니다 = 마지막으로 반영된 Aconex 이벤트가 Terminated가 아니다"라는 **덮어쓰기 순서 논증**입니다. 실무상 타당하지만 논리적으로는 간접 증거이므로, 이 근거를 migration 주석에 명시하고 대상 목록(ABD Number 325건)을 보존한 뒤 실행합니다.

### 3-3. 플래그 보정량 ≠ KPI 감소량
`abd_bucket_of`의 `RESUBMIT`은 catch-all(Approved/UR/DS 어디에도 안 걸린 나머지 전부)입니다. 325건을 해제해도 `abd_judge_v1`이 UR/DS/Approved로 판정하지 못하는 행은 그대로 `RESUBMIT`에 남습니다. 따라서 **적용 전에 가상 해제 시뮬레이션으로 버킷 재판정 결과를 산출**해 두 수치를 분리 보고합니다.

## 4. 확정 보정 조건 (migration)

대상: `is_terminated = true` AND `is_active = true` AND `aconex_date_modified IS NOT NULL` AND (`aconex_status_raw`, `aconex_review_status_raw`)가 다음 3조합 중 하나

```text
('For Review',              'Under Workflow Review')
('A - Approved',            'Approved')
('C - Revise and Resubmit', 'Revise & Re-Submit')
```

제외: Terminated 조합, NULL·공란·미등록 조합, `is_active=false`, D-code. 조건부 UPDATE만 수행하여 재실행 시 변경 0건(멱등).

## 5. 임포트 교정 (미해결 결정 사항 유지)

`computePatch()`의 해제 전환은 앞서 보고한 **같은 날(`date` 타입) 이벤트 처리 방식** 결정이 선행되어야 합니다. 현재 계획은 semantic 우선순위(재제출/회신 > Terminated)로 동일 날짜도 결정론적으로 해제하는 안입니다.

## 6. 실행 범위

- 이번 단계: 시뮬레이션 수치 산출 + 임포트 교정 코드 + 단위 테스트(Test 1~7)
- migration 적용·운영 Import·배포는 별도 승인 후
