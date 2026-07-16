## 원인
현재 임포트가 멈춘 직접 원인은 DB upsert 단계 전의 **기존 행 조회 요청이 400 Bad Request로 실패**하는 것입니다.

구체적으로 `src/contexts/DefectManagementImportContext.tsx`에서 기존 `source_issue_no` 목록을 조회할 때 한 번에 최대 1000개를 `.in("source_issue_no", chunk)`로 보냅니다. 이번 파일의 `source_issue_no` 값들이 UUID처럼 매우 길고 개수가 많아 URL이 과도하게 길어졌고, backend REST 요청이 `400 Bad Request`로 거절됩니다.

현재 코드는 이 조회 단계의 `error`를 확인하지 않아, 실패해도 기존 행이 0개인 것처럼 계속 진행합니다. 그 결과 UI는 `Processing/Importing…` 상태에서 멈춘 것처럼 보이고, 이후 upsert도 불필요하게 위험한 방향으로 진행될 수 있습니다.

## 수정 계획

### 1. 기존 행 조회 chunk 크기 축소
`EXISTING_FETCH_CHUNK`를 현재 `1000`에서 URL 제한에 안전한 크기(예: `100`)로 낮춥니다.

- 긴 UUID/문자열 issue no에서도 `.in()` URL이 400을 내지 않게 합니다.
- `EXISTING_FETCH_CONCURRENCY`는 유지하거나 필요 시 소폭 조정해 전체 속도 저하를 최소화합니다.

### 2. 기존 행 조회 실패를 명시적으로 처리
기존 행 조회 중 `{ error }`가 발생하면 조용히 무시하지 않고 즉시 throw 하도록 수정합니다.

- 실패 원인이 카드의 error/failed 상태로 표시됩니다.
- “계속 Importing…”처럼 원인이 보이지 않는 상태를 막습니다.
- re-import 파일에서 기존 매칭 실패를 잘못 계산하는 문제를 방지합니다.

### 3. 빠른 임포트를 위한 우선 경로
이번 파일은 버튼 상태상 `AI 분류`가 꺼져 있으므로, 빠른 임포트는 아래 방식으로 유지합니다.

- AI 분류 OFF 상태 유지
- 기존 행 조회 chunk 축소 후 바로 Start import 재시도
- row log 삽입은 현재처럼 백그라운드 유지
- upsert chunk는 기존 안정값 `100` 유지

### 4. 사용자 진행 상태 개선
가능하면 진행률이 기존 행 조회 단계에서도 멈춘 것처럼 보이지 않도록 최소한의 상태 업데이트를 추가합니다.

- 기존 행 조회 시작 후 파일 progress를 소폭 갱신하거나
- 실패 시 명확한 에러 메시지를 표시합니다.

## 검증
- 동일 파일 업로드 후 `컬럼 선택`이 81개 헤더를 보여주는지 확인
- Start import 클릭 후 `defect_items_raw` 기존 행 조회가 400 없이 성공하는지 확인
- 파일 카드가 `Processing`에서 `Done` 또는 명확한 `Failed` 상태로 전환되는지 확인
- 네트워크 요청에서 `defect_items_raw?...source_issue_no=in...` 400이 사라지는지 확인