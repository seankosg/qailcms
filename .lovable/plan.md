## 원인 분석

콘솔 로그에서 문제가 명확히 드러납니다:

```
batch upsert error: null value in column "team" of relation "defect_items_raw" violates not-null constraint
[defect-import] batch 0 rows=100 34721ms
[defect-import] batch 1 rows=100 34638ms
...
```

**핵심 원인 (Client-side)**
사용자가 81개 헤더 중 3개만 선택했는데, 그 3개에 **팀을 결정할 수 있는 컬럼(Category / Team)** 이 포함되지 않았습니다. 그 결과:

1. 모든 payload의 `team = null`이 되어 DB의 NOT NULL 제약을 위반 → 배치 전체가 실패
2. 실패 시 이진 분할(binary split) 재시도가 발동 → 100행 배치가 1행 단위까지 쪼개져 개별 upsert 수백 번 발생
3. 각 개별 upsert도 동일한 이유로 실패하지만 네트워크 왕복 + 트리거/인덱스 갱신 오버헤드가 누적 → 배치당 **34초** 소요
4. 총 446 배치 × 34초 ÷ 2(동시성) ≈ **2시간 이상** 소요 예상 (사실상 무한 진행처럼 보임)

**보조 원인 (Server-side, 부차적)**
`defect_items_raw`에 사용되지 않는 GIN/Trigram 인덱스가 다수 존재 (idx_scan=0, 총 ~90 MB) — 개별 upsert 왕복이 많을수록 인덱스 유지 비용이 배가됩니다. 다만 이번 지연의 주범은 아니며, 앞선 세션에서 이미 제안한 정리 대상과 동일합니다.

## 수정 계획

### 1. 프리플라이트 검증 (핵심)
`DefectManagementImportContext.tsx`의 payload 빌드 직후, DB 요청 전에 다음을 수행:

- `payloads` 배열에서 `team === null` 인 행을 **클라이언트 측에서 즉시 필터링**
- 필터링된 행은 `rejected` 카운트로 집계하고 `importErrors`에 사유("team 미결정 — Category/Team 컬럼이 제외되었거나 매핑되지 않음")를 기록
- 만약 `payloads` 전량이 `team = null`이면, **DB 호출을 시작하지 않고** 즉시 파일을 `failed` 상태로 마감하고 툴팁 메시지 표시:
  > "선택한 컬럼만으로는 팀(Team)을 결정할 수 없습니다. Category(또는 Team) 컬럼을 포함해서 다시 시도하세요."

### 2. 컬럼 선택 UI에서 사전 경고
`DefectColumnSelect.tsx`에 요건(`getRequirement`) 확장:
- Category / Team 매핑 헤더 중 하나 이상이 반드시 포함되도록 하고, 모두 제외 시 다이얼로그 Apply 단계에서 경고 배지 표시 ("팀 결정에 필수 — 제외 시 임포트 실패").

### 3. 이진 분할 조기 종료
`upsertWithBinarySplit`에서 오류 코드가 **`23502` (NOT NULL 위반)** 이나 **`23514` (CHECK 위반)** 인 경우 재분할 없이 즉시 개별 실패로 처리 (분할해도 결과가 바뀌지 않는 결정적 오류이므로).

### 4. (별도 확인 후) 미사용 인덱스 정리
사용자 승인 후 다음 인덱스 drop (총 ~90 MB, idx_scan=0):
`defect_items_raw_location_trgm_idx`, `hdec_pic_trgm_idx`, `remarks_trgm_idx`, `area_location_trgm_idx`, `sub_trgm_idx`, `idx_defect_items_raw_data_date`, `idx_defect_items_raw_area`, `active_group_sub_idx`, `active_group_arealevel_idx`, `idx_defect_items_raw_actual_start`, `idx_defect_items_raw_planned_closure`.
→ 이번 티켓의 원인은 아니므로 별도 승인 절차로 진행.

## 즉시 조치 (사용자 측)

현재 실행 중인 임포트를 취소하고, Files 카드에서 파일을 제거한 뒤 재시도하실 때 **컬럼 선택 다이얼로그에서 `Category`(팀 매핑) 헤더를 포함**하여 다시 진행해 주세요. 위 수정이 반영되면 이런 상황은 프리플라이트 단계에서 즉시 안내되어 시간 낭비 없이 실패로 처리됩니다.

## 기술 세부 (참고)

- 변경 파일: `src/contexts/DefectManagementImportContext.tsx` (프리플라이트 필터/조기 종료), `src/components/defect-management/import/DefectColumnSelect.tsx` (경고).
- DB 스키마 변경 없음.
- 성공 기준: `team=null` 상태로 시작 → 첫 배치 왕복 없이 즉시 실패 메시지 표출 (초 단위 이내).
