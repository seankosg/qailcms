## 배경 확인

- `task_management_raw.actual_finish` 는 현재 파서/임포트 경로에서 **한 번도 채워지지 않고**, 인라인 편집으로만 입력되고 있음. (`rg actual_finish` 결과 columns/display/export 만 참조)
- "Revise Finish" 는 UI 라벨이고 실제 컬럼은 `forecast_end` (columns.ts 156 라인: `label: "Revised Finish"`).
- "Data Date" 는 시트 상단에서 파싱되어 `dataDate` 로 임포트 컨텍스트에 전달되고, 각 행 저장 시 `data_date` 컬럼에 기록됨.
- 실제 영향 범위 (현재 DB 기준): `actual_progress=1 AND actual_finish IS NULL` = **155건**  
  (forecast_end 보정 가능 135건 + data_date 보정 가능 20건, 미해결 0건)

## 확정 규칙

임포트 시(그리고 1회 마이그레이션에서) 아래 조건을 만족하면 `actual_finish` 를 채운다.

- 대상: `actual_progress = 1` (100%) **이고** `actual_finish IS NULL`
- 우선순위: `forecast_end` (Revise Finish) → `data_date`
- 이미 `actual_finish` 값이 있으면 절대 덮어쓰지 않음
- `actual_progress` 가 100 미만이면 어떤 경우에도 건드리지 않음

## 구현 범위

### 1) 임포트 로직 보정 — `src/lib/task-management/parser.ts`

`parseTaskManagement()` 각 행 push 지점(701~741 라인)에 이미 `forecast_end`, `actual_progress` 를 뽑고 있고, 상위에서 `dataDate` 를 알고 있음. row 객체에 새 필드 `actual_finish` 를 추가하되 다음 폴백을 적용:

```
actual_finish =
  (actual_progress === 1)
    ? (forecast_end ?? dataDate ?? null)
    : null
```

- 파서 타입(`ParsedTaskRow`)과 관련 매핑에 `actual_finish` 필드 추가.
- Excel 원본에 A.Finish 컬럼이 실제로 매핑돼 오는 상황은 현재 없으므로 신규 파생 규칙만 적용해도 충돌 없음. (원본 존중 규칙이 필요해지면 이후 별도 요청으로 처리)

### 2) 임포트 컨텍스트에서 DB 페이로드에 포함 — `src/lib/task-management/TaskManagementImportContext.tsx` (해당 upsert 페이로드 조립부)

- upsert 페이로드에 `actual_finish` 필드 추가.
- 기존 "null 로 덮어쓰지 않기" 규칙(`stripNullExcept`)과 충돌하지 않도록, 값이 계산돼 채워진 경우에만 포함 (파서 폴백이 null 이면 페이로드에서 자연스럽게 제외됨).

### 3) 1회 마이그레이션 (Supabase migration)

```
UPDATE public.task_management_raw
SET actual_finish = COALESCE(forecast_end, data_date)
WHERE actual_progress = 1
  AND actual_finish IS NULL
  AND COALESCE(forecast_end, data_date) IS NOT NULL;
```

- 예상 영향 155행. `trg_task_actual_duration_fn` 트리거가 `actual_finish` 세팅에 반응해 `actual_duration` 도 자동 재계산됨(부수 효과 원하는 방향).
- `trg_task_history_fn` 로 인해 상태 이력이 남을 수 있음 (허용).

## 검토 필요/질문 없음

- Data Date 는 시트 상단 파싱값을 사용 (파서가 이미 채우는 `dataDate` 그대로 사용).
- 100% 판정 기준은 DB 저장 스케일(0~1) 기준 `= 1`.
