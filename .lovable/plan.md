## 현재 상태 확인

업로드된 파일 `Task_Management_Mech_260722_KD_Park_R1.xlsx`와 현재 `src/lib/task-management/parser.ts`의 `toIsoDate()` 함수를 확인한 결과, **현재 TM 파서는 파일 날짜를 도하(Asia/Qatar, UTC+03:00) 시간으로 인식하지 않습니다.**

- `toIsoDate()`가 Date 객체, Excel serial, 문자열 날짜를 모두 **런타임 로컬/UTC 컴포넌트**로 변환하고 있음.
- `src/lib/time/doha.ts`에 있는 `dohaLocalDateToUtcIso()` / `dohaWallToUtcIso()` 도구는 파서에서 사용되지 않음.
- 이전에 요청하신 "원본 엑셀 날짜 컬럼을 도하 시간으로 해석하도록 임포트 로직 수정"이 아직 파서에 반영되지 않은 상태.
- ABD 파서(`src/lib/abd/parser.ts`)에서도 동일하게 로컬/UTC 기준 변환을 사용 중.

또한 업로드 파일은 `Gantt` 시트에 `Data Date`가 3행, Task No가 5행 이후에 있는 비표준 구조라, **컬럼 매핑 자체가 정상적으로 될지도 함께 확인해야 합니다.**

## 계획

1. **TM 파서 날짜 변환을 도하 기준으로 변경**
   - `src/lib/task-management/parser.ts`의 `toIsoDate()`를 수정.
   - `Date` 객체 → `dohaLocalDateToUtcIso()` 사용.
   - Excel serial → `XLSX.SSF.parse_date_code`로 날짜 추출 후 `dohaWallToUtcIso()`로 변환.
   - `YYYY-MM-DD` 문자열 → 그대로 도하로 간주, UTC ISO로 변환.
   - Data Date 탐색 로직(`scanForDate`)도 동일 기준으로 변경.

2. **ABD/SM/DMR/SparePart 파서에도 동일 원칙 적용**
   - 각 모듈의 `toIsoDate()` 또는 동등 함수를 찾아 도하 기준으로 통일.
   - Date 객체, Excel serial, 문자열 모두 동일하게 처리.

3. **파서 안전성 보강**
   - Excel serial에서 날짜/시간 구분 처리(시간 부분은 00:00:00으로 폐기, 날짜만 저장).
   - 변환 실패 시 `null` 반환 및 경고 메시지 유지.
   - 무효한 날짜(예: 1899-12-30) 필터링 강화.

4. **업로드 파일 매핑 확인**
   - 비표준 `Gantt` 시트 구조(헤더가 5행이 아닌 1~3행에 분산)를 확인.
   - 현재 30행 스캔 로직으로 자동 헤더 감지가 가능한지, 아니면 별도 매핑 개선이 필요한지 판단.
   - 필요 시 해당 파일에 대한 수동 헤더 위치 override 또는 별도 시트 처리 옵션 추가 검토.

5. **검증**
   - 업로드 파일 내 표시된 날짜(예: `2026-07-22`, `2026-07-23`)가 DB에 저장될 때 동일한 달력일로 유지되는지 확인.
   - UTC ISO로 저장 후 표시 시 `formatDdMmmYyyy()` 등 도하 포맷터로 원래 날짜가 그대로 출력되는지 확인.
   - TM, ABD, SM, DMR, SparePart 임포트 각각에 대해 날짜 손실/하루 어긋남이 없는지 검증.

## 배제하지 않은 부분
- 파일 구조가 매우 비표준일 경우 별도의 매핑 설정이 추가로 필요할 수 있습니다. 이 경우 추가 질문을 드리겠습니다.
- 날짜뿐 아니라 시간(`HH:mm`)을 포함한 datetime 컬럼은 현재 TM 모델에 없으므로, 이 계획은 date-only 범위로 한정합니다.