## 목표
ABD / SM / TM 임포트에서 헤더 행 탐색 범위를 **상단 30행**까지 확장하여, 파일 상단에 제목·설명·빈 행 등이 있어도 헤더를 자동으로 찾도록 개선합니다.

## 현재 상태 (확인 완료)

| 도메인 | 파일 | 현재 로직 | 문제 |
|---|---|---|---|
| ABD | `src/lib/abd/parser.ts` L191 | 0~10행 스캔 (`Math.min(range.s.r + 10, ...)`) 하며 `SL.NO` + `ABD NUMBER` 앵커 탐색 | 11행 이후에 헤더가 있으면 실패 |
| SM (Defect) | `src/lib/defect-management/parser.ts` L311 `scanHeaders` | **1행 고정** (`r: 0`) — 스캔 없음 | 상단에 빈 행/제목이 있으면 전부 실패 |
| TM (Task) | `src/lib/task-management/parser.ts` L178 `buildHeaderMap` | **5행 고정** (`HEADER_ROW = 5`) — 스캔 없음 | 파일 구조가 조금만 밀려도 실패 |

## 변경 사항

### 1. ABD (`src/lib/abd/parser.ts`)
- `findHeader`의 스캔 상한을 `range.s.r + 10` → `range.s.r + 29`로 변경 (총 30행 후보).
- 기존 앵커 판정 로직(`SL.NO` + `ABD NUMBER` 동시 존재)은 유지 → 오탐 없음.

### 2. SM/Defect (`src/lib/defect-management/parser.ts`)
- `scanHeaders(sheet)`에 헤더 행 자동 탐지 추가:
  - 0~29행을 순회하며, **정규화된 헤더가 가장 많이 매칭되는 행**을 헤더 행으로 선택 (임계값: 최소 3개 이상 헤더 셀).
  - 매칭 기준: `normalizeHeader` 결과가 비어있지 않은 셀 개수. 필요 시 필수 후보(`id`, `plot`, `location`, `description`, `source_issue_no` 등) 가중치 부여.
  - 헤더 행이 결정되면 sample 은 `headerRow + 1` 에서 읽음.
- 반환 타입에 `headerRow: number` 추가 → 이후 데이터 행 반복 시 `headerRow + 1`부터 시작하도록 호출부 조정 (`parseDefectFile` 내 data loop 시작 인덱스).

### 3. TM/Task (`src/lib/task-management/parser.ts`)
- `buildHeaderMap`에 자동 탐지 추가:
  - 1~30행(0-based 0~29)을 순회하며, 정규화 헤더가 최다 매칭되는 행을 선택 (fallback: 기존 5행 고정).
  - 열 범위 상한 `Math.min(range.e.c, 25)`는 유지하되 필요 시 40까지 확장 검토 (이번 스코프에서는 유지, 필요 시 별도 요청).
- 반환값에 `headerRow` 추가하고 `parseTmSheet` 내 데이터 행 시작 인덱스를 `HEADER_ROW` 하드코딩 대신 동적 값으로 대체.

### 4. 로그/경고
- 각 파서에서 자동 탐지된 실제 헤더 행(1-based)을 `warnings` 또는 파싱 결과 메타에 기록 → 임포트 로그에서 확인 가능.
- 매칭 헤더가 임계값 미만이면 기존 동작(SM=1행, TM=5행)으로 폴백하고 경고 메시지 남김.

## 영향 범위
- 파서 3개 파일만 수정. UI/DB/스키마 변경 없음.
- 기존 정상 파일(헤더가 지정 행에 있는 파일)은 자동 탐지 시에도 동일 행을 선택하므로 회귀 위험 낮음.

## 검증
- 기존 정상 파일 재임포트 → 동일 결과 확인.
- 상단에 빈 행 몇 개를 추가한 샘플 파일 → 헤더 자동 인식 확인.
- 헤더가 완전히 다른 파일 → 임계값 미달로 폴백 + 경고 노출 확인.