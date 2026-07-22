
## 목표

`status_raw`가 미완료 계열(`open`, `new`, `re-opened`, `reopened`, `re open`, `reopen`, `re-open`)일 때 `start_status`(UI 파생 Done 여부)에 따라 `rectified_status`를 두 값으로 분기한다.

- Start가 Done → **Not finish yet** (작업 시작됨, 미완료)
- Start가 Done 아님 → **Not start yet** (아직 시작 전)

그리고 각 Rectified Status 값에 서로 다른 뱃지 색상을 부여하고, DefectStageProgress의 Rectified 단계 매핑을 신규 값에 맞게 조정한다.

## 변경 범위

### 1. `src/lib/defect-management/derived.ts`
`deriveRectifiedStatus`의 시그니처를 확장하여 start done 여부를 함께 받는다.

```ts
deriveRectifiedStatus(statusRaw, row): string
```

- `closed`, `verified`, `rectified`, `complete`, `completed` → `Rectified` (기존 유지)
- `in progress`, `inprogress`, `wip`, `under review` → `In Progress` (기존 유지)
- `re-opened`/`reopened`/`re open`/`reopen`/`re-open`/`open`/`new`/공백:
  - Start Done이면 → `Not finish yet`
  - 아니면 → `Not start yet`

Start Done 판단 기준(기존 `stage-utils.isStageDone`과 동일):
`actual_start_date` 존재 OR `actual_progress_pct > 0` OR `actual_rectified_date`/`actual_closure_date` 존재.

### 2. `src/contexts/DefectManagementImportContext.tsx` (라인 905)
`deriveRectifiedStatus(p.status_raw)` 호출부에서 이미 결정된 `base`(actual_start_date, actual_progress_pct 등)를 두 번째 인자로 전달. Rectified/Closure 관련 필드가 base에 세팅된 이후로 호출 순서를 유지하면 되며 현 위치에서 그대로 동작.

### 3. `src/lib/defect-management/columns.ts`
- `RECTIFIED_STATUSES`에 `"Not start yet"` 추가 (순서: `Not start yet`, `Not finish yet`, `In Progress`, `Rectified`).
- `STATUS_COLORS`에 값별 색상 지정:
  - `Not start yet` → zinc (회색, 미착수)
  - `Not finish yet` → amber/주황 계열 (진행 중이나 미완료)
  - `In Progress` → sky (파랑)
  - `Rectified` → emerald (초록)

  현재 `In Progress`가 amber이므로 겹치지 않게 재분배: `Not finish yet` = orange, `In Progress` = amber, `Rectified` = emerald, `Not start yet` = zinc.

### 4. `src/components/defect-management/raw-data/DefectStageProgress.tsx`
`classifyStage` Rectified 분기 로직 갱신:
- `rectified_status === "Not finish yet"` → **wip**
- `rectified_status === "Not start yet"` → **planned** (또는 planned_rectified_date 없으면 empty)
- 나머지는 기존 규칙 유지.

Start Done인데 아직 progress=0인 케이스에서도 Rectified 스테이지가 WIP로 표시되어 Start와 Rectified 사이의 흐름이 자연스러워진다.

### 5. DB 마이그레이션 (1회성)

현재 `rectified_status='Not finish yet'` 총 60,526행 중 Start Done 판정 미충족 39,806행을 `Not start yet`으로 UPDATE.

```sql
UPDATE defect_items_raw
SET rectified_status = 'Not start yet'
WHERE rectified_status = 'Not finish yet'
  AND actual_start_date IS NULL
  AND COALESCE(actual_progress_pct, 0) = 0
  AND actual_rectified_date IS NULL
  AND actual_closure_date IS NULL;
```

나머지 20,720행은 `Not finish yet` 그대로 유지.

## 영향 없는 영역

- `deriveClosureStatus` 로직 변경 없음.
- Progress RPC(`defect_snag_progress_totals/cells`) 는 actual date 기반 집계이므로 변경 불필요.
- 필터 UI의 Rectified Status 옵션 목록은 `RECTIFIED_STATUSES` 상수를 참조하므로 자동 반영.

## 검증

1. 마이그레이션 후 `rectified_status`별 카운트 재확인.
2. Raw Data 화면에서 4개 값이 각기 다른 색상 뱃지로 표시되는지 시각 확인.
3. 임의 행에서 Start Done + 미완료인 경우 `Not finish yet`, Start 미착수인 경우 `Not start yet`로 표시되는지 확인.
4. Stage Progress 파이프: Not start yet 행은 Rectified pip이 planned(빈 원), Not finish yet 행은 WIP(반달) 표시.
