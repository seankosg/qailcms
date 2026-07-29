## 확인된 현재 상태

- 서버 로그에 같은 시각대 `Worker exceeded CPU time limit` 502가 재발했습니다.
- 현재 클라이언트는 이미 `rows`를 500행 HTTP 청크로 나누지만, 서버 함수 한 번당 여전히 다음 작업을 모두 수행합니다.
  - 기존 행 조회
  - upsert
  - 행 로그(`abd_import_row_logs`) 생성
  - 필드 로그(`import_field_logs`) 대량 생성
  - 마지막 청크에서 `inactivate_missing` 전체 스코프 처리
- ELEC 파일은 약 4,063행이고, ABD tracked field가 약 40개라서 500행 청크 1회에도 필드 로그가 최대 약 20,000건까지 생성될 수 있습니다. 따라서 단순 row 청크만으로 CPU 한계가 해결되지 않은 상태입니다.

## 수정 계획

### 1. 서버 함수 청크 크기 축소
- `AbdImportPage.tsx`의 HTTP 청크를 500행에서 더 작은 단위로 낮춥니다.
- 1차 목표는 100행입니다.
- 이유: 서버 함수 1회가 처리하는 diff 계산, upsert payload, 로그 생성량을 확실히 줄여 Worker CPU 한계를 피합니다.

### 2. ABD 필드 로그 생성량 제한
- `importAbdBatch`에서 필드 로그는 모든 `unchanged`까지 기록하지 않고, 실제 변경/적용된 값 중심으로 축소합니다.
- 유지:
  - `applied`
  - inactivate info
  - 오류/충돌성 로그가 생기는 경우
- 제외:
  - 대량 `unchanged` 필드 로그
- 목적: 4,000행 × 수십 필드의 로그 폭증을 제거합니다.
- Import Record의 핵심 추적성은 유지하되, “변경 없는 필드 전부”를 남기느라 임포트가 실패하는 구조를 제거합니다.

### 3. 마지막 finalize 병목 분리
- `finalize=true` 호출에서만 수행되는 `inactivate_missing`가 전체 active row를 읽고 비교합니다.
- 이 부분이 여전히 길어질 수 있으므로, 이번 수정에서는 다음 방어를 추가합니다.
  - finalize 호출도 작은 청크 payload만 포함하도록 유지
  - inactivate 로그/필드 로그 삽입도 작은 단위로 유지
  - 에러 메시지가 502일 때 화면에 원인을 더 명확히 표시

### 4. UI 에러 메시지 개선
- 현재 화면에는 서버의 502가 `Internal server error`로만 보입니다.
- 클라이언트 catch에서 502/CPU timeout 계열 메시지를 감지하면 다음처럼 표시합니다.
  - “서버 처리 시간이 초과되었습니다. 더 작은 청크로 자동 재시도하거나 다시 실행하세요.”
- 단, 자동 재시도는 같은 실패를 반복할 수 있으므로 이번에는 청크 축소 + 원인 표시까지만 적용합니다.

### 5. 수정 금지 범위 준수
이번 작업에서는 아래 로직은 변경하지 않습니다.
- `aconex-import.functions.ts` 적용 로직
- `computePatch`, Terminated 가드, WATCH_NULL_FIELDS 감사, build_id
- `abd_judge_v1`, `abd_items_search`, 트리거, Dashboard/Progress RPC
- ABD 판정/대시보드/Progress 정합성 산출물

### 6. 검증
- 배포 전 코드 경로 확인:
  - HTTP 청크가 100행으로 낮아졌는지
  - `unchanged` 필드 로그가 대량 생성되지 않는지
  - 파일당 `abd_import_logs` 1건 유지 및 `log_id` append 흐름이 유지되는지
- 서버 로그 확인:
  - 동일 작업 직후 `Worker exceeded CPU time limit` 재발 여부 확인
- 가능하면 업로드된 ELEC 파일과 동일 조건으로 재시도하여:
  - Failed가 아닌 Done 상태 도달
  - Import Log에 inserted/updated 누적값 기록
  - 마지막 finalize에서 inactivated 값 기록 여부 확인

## 완료 보고 형식

완료 후에는 아래 2가지만 보고합니다.

1. 원인 및 수정 요약
2. 검증 결과: Worker CPU timeout 재발 여부 / 임포트 완료 여부