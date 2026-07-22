## 원인

`src/lib/defect-management/stage-utils.ts`의 `isStageDone`이 Rectified/Closure 스테이지에서 오직 실적 날짜/진도율만 검사하기 때문에, `status_raw`나 파생 상태가 이미 완료 계열이더라도 실적 날짜가 비어있으면 아이콘이 "planned"로 표시됩니다.

DB 확인 결과 (ID 100840 / 100850 / 100854):

| source_issue_no | status_raw | rectified_status | actual_rectified_date |
|---|---|---|---|
| 100840 | Rectified | Rectified | NULL |
| 100850 | Rectified | Rectified | NULL |
| 100854 | Rectified | Rectified | NULL |

앞서 확립된 규칙 "status_raw가 rectified 계열 → Start=Done, Rectified=Rectified"는 파생값에만 반영되었고 `isStageDone`의 Rectified/Closure 분기에는 반영되지 않았습니다.

## 수정 방침

`src/lib/defect-management/stage-utils.ts`의 `isStageDone` 함수만 수정합니다(기존 조건 유지, OR로 확장).

**Rectified 분기 추가 조건**
- `status_raw` ∈ { rectified, complete, completed, closed, verified } → Done
- `rectified_status` == `Rectified` → Done

**Closure 분기 추가 조건**
- `status_raw` ∈ { closed, verified } → Done
- `closure_status` ∈ { Closed, Verified } → Done

Start 분기는 이미 status_raw 완료 계열을 Done 처리하고 있으므로 변경 없음.

## 변경 범위

- **수정 파일**: `src/lib/defect-management/stage-utils.ts` — `isStageDone`의 rectified / closure 분기에 위 OR 조건 추가.
- **파급 (자동 반영)**:
  - `DefectStageProgress.classifyStage` → 아이콘 done(●, 초록) 표시
  - `isActualComplete`, `isClosureComplete`, `classifyDefectStage`, `isStageDelayedAsOf` → Rectified/Closure 완료 정합성 확보
- **DB 마이그레이션 없음** — 코드 로직 수정만.
- **서버 RPC**(`defect_items_search` 등)는 이번 스코프에서 건드리지 않음(리포트는 UI 아이콘 문제). 필요 시 별도 지시로 확장.

## 검증

`/closure/raw-data`에서 ID 100840 / 100850 / 100854의 Progress 아이콘이 Start ● + Rectified ● (초록) 로 표시되는지 확인. Closure는 `status_raw`/`closure_status`가 Closed·Verified인 샘플로 별도 확인.