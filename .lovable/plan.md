## 배경

ABD 임포트 파일 `PLOT C&D MECH ABD 완료계획_260723_.xlsx` 업로드 시 파일 카드에 `Invalid time value` 에러가 표시되며 "0 ready to import" 상태로 진입이 막힘.

원인 요약:
- 엑셀의 날짜 컬럼에 "TBD", "PENDING", "-", "0" 같은 비-날짜 값 또는 잘못된 Excel serial(0/음수)이 섞여 있음
- `src/lib/time/doha.ts`의 `toDohaDateKey()`가 유효하지 않은 Date에 대해 `.toISOString()`을 호출 → JS 런타임이 `RangeError: Invalid time value`를 던짐
- `src/lib/abd/parser.ts`의 `toIsoDate()`가 `toDohaDateKey`·`dohaWallToUtcIso` 결과를 감싸지 않아 예외가 파서 전체를 중단시키고, ABD 임포트 UI가 파일 카드 아래에 `Invalid time value` 배지로 표기

## 수정 범위 (프론트엔드/파서만, 비즈니스 로직·DB 스키마 변경 없음)

### 1. `src/lib/time/doha.ts` — 방어 로직 강화
- `shiftToDoha`, `toDohaDateKey`, `dohaWallToUtcIso`, `dohaDateKeyToUtcIso`, `dohaStamp*`, `dohaDateTime` 등 모든 헬퍼에서 다음 케이스를 `null`(문자열 반환 함수는 `""`)로 처리:
  - `Date` 객체가 `NaN` (`isNaN(d.getTime())`)
  - 문자열 파싱 결과가 `Invalid Date`
  - `dohaWallToUtcIso`의 년/월/일이 비정상 범위(예: y<1900 또는 y>2999, m<1||>12, d<1||>31)
- 각 함수 진입 시 try/catch 없이 사전 검증 → `.toISOString()` 호출 자체를 회피

### 2. `src/lib/abd/parser.ts` — `toIsoDate` 안전화
- 함수 전체를 `try { ... } catch { return null; }` 로 감싸 최후 방어선 마련
- Excel serial의 경우:
  - `v <= 0` 또는 `!Number.isFinite(v)` 즉시 `null`
  - `XLSX.SSF.parse_date_code` 결과의 `y/m/d` 유효성 검증 후에만 `dohaWallToUtcIso` 호출
- 문자열 케이스 강화:
  - 대문자화하여 `TBD`, `PENDING`, `TBA`, `NA`, `N/A`, `#N/A`, `-`, `--` 이면 `null`
  - `dmy`/`ymd` 정규식 매치 후 `Number(m) 1..12`, `Number(d) 1..31` 검증

### 3. ABD 임포트 컨텍스트 — 파일 단위 예외 격리
- 파일 카드에 뜨는 `Invalid time value` 문구를 만든 지점을 찾아, 파서가 예외를 던지더라도 해당 파일만 "실패" 상태로 남고 전체 큐가 멈추지 않도록 처리
  - `src/contexts/AbdImportContext.tsx` (또는 동등 파일)의 `parseWorkbook`/`prepareRows` 호출부를 `try/catch`로 감싸고, 에러 메시지를 사용자에게는 "날짜 형식이 올바르지 않은 셀이 있어 스킵되었습니다"로 표기
  - 파일 상태를 `error`로 유지하면서 다른 파일 처리는 계속

### 4. 타 모듈 회귀 확인 및 동일 패치 이식
동일한 `toIsoDate` 패턴을 사용하는 다음 파서/유틸에도 위 1·2의 방어 로직을 그대로 적용해 회귀 방지:
- `src/lib/defect-management/parser.ts` (SM)
- `src/lib/task-management/parser.ts` (TM)
- `src/lib/dmr/utils.ts` (DMR)
- `src/lib/spare-part-import-parser.ts` (Spare Part)

각 파일의 로컬 `toIsoDate`가 동일 결함(비-날짜 문자열/음수 serial → 예외)을 갖는지 재확인 후, 동일한 사전 검증 및 try/catch 래핑 추가.

## 검증

1. TypeScript 타입체크 통과 확인
2. 문제의 원본 파일(`PLOT C&D MECH ABD 완료계획_260723_.xlsx`)을 임포트 UI에서 다시 업로드하여:
   - 파일 카드에 `Invalid time value` 배지가 사라지고 정상적으로 "N ready to import"로 진행되는지
   - 비-날짜 셀은 `null`로 임포트되고, 정상 날짜 셀은 도하 기준으로 저장되는지 (Raw Data에서 몇 행 샘플 확인)
3. SM/TM/DMR 임포트에서 기존 정상 파일이 그대로 동작하는지 회귀 확인

## 비고

- DB 스키마·RLS·RPC 변경 없음
- 사용자에게 보이는 UI 변경은 파일 카드 에러 문구 개선(옵션) 외에는 없음
- 도하 시간 해석 정책은 유지, 잘못된 셀만 안전하게 `null` 처리
