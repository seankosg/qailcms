## 목표
Snag Import의 Column Select Dialog에서 실제로 파일에 존재하는 모든 헤더(현재 파일 기준 81개, `id` 제외 시 80개)가 스캔·표시·매핑되도록 파서를 수정한다.

## 원인
`src/lib/defect-management/parser.ts`의 `scanHeaders`가 열 스캔을 61열까지로 하드코딩 제한한다.

```ts
for (let c = range.s.c; c <= Math.min(range.e.c, 60); c++)
```

이 때문에 62번째 열부터 뒤에 있는 헤더는 `headerMap`/`entries`에 포함되지 않아,
`toDefectFieldName`이 호출조차 되지 않고 Column Select Dialog에서 아예 보이지 않는다.
잘려 나가는 대표 컬럼: `updated_date_raw`, `actual_start_date`, `planned_start_date`, `planned_completion_date`, `actual_completion_date`, `planned_closure_date`, `actual_closure_date`, `planned_progress_pct`, `actual_progress_pct`, `completion_status`, `location_reference`, `updated_description`, `created_by_team_name` 등.

## 변경 내용

### `src/lib/defect-management/parser.ts`
`scanHeaders` 루프의 상한을 실제 시트 열 범위(`range.e.c`)로 변경한다.

```ts
for (let c = range.s.c; c <= range.e.c; c++) { ... }
```

즉 `Math.min(range.e.c, 60)` 부분에서 60 상한을 제거한다. 시트에 실제 존재하는 열까지 모두 스캔한다.

다른 로직(정규화·별칭 해석·`isKnownDefectField` 등)은 이미 이 케이스를 지원하고 있어 수정이 불필요하다.

## 예상 결과
현재 업로드한 파일(81 헤더) 기준
- 매핑됨: 80개 (기존 canonical + EXTRA + DB 별칭)
- unmapped 상태로 남는 컬럼(파서에 대응 필드가 없는 시스템/감사용, 이번 스코프 밖):
  `status_group`, `is_active`, `is_critical`, `issue_no`, `created_at`, `updated_at`, `raw_payload`, `row_version`, `trade_detail`, `classified_at`, `status_manual`, `custom_payload`, `aconex_comments`, `priority_locked`, `captured_by_name`, `critical_marked_at`, `critical_marked_by`, `source_import_log_id`, `classification_source`, `subcontractor_issue_no`, `hdec_verification_locked`, `subcontractor_issue_source`
- `id`는 이전 조치대로 canonical 매핑이 제거된 상태 유지

시스템/감사용 22개 컬럼은 파서가 인식할 target field 자체가 없으므로 이 스코프에서 다루지 않는다. 필요하면 별도 요청으로 확장한다.

## 검증
- Snag Import 화면에서 이 파일을 다시 업로드해 Column Select Dialog에서 헤더가 81개 노출되고 그 중 80개가 mapped, 22개(시스템/감사 컬럼)만 unmapped로 표시되는지 확인.
- `planned_start_date`, `planned_completion_date`, `actual_start_date`, `actual_completion_date`, `planned_closure_date`, `actual_closure_date`, `planned_progress_pct`, `actual_progress_pct`, `completion_status`, `updated_description`, `location_reference`, `created_by_team_name`, `updated_date_raw`가 각각 해당 target field로 매핑되는지 확인.
