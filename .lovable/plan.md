# SM 임포트 날짜 하루 빠름 — 수정 계획

## 원인 요약 (사용자 친화 설명)

- Excel 파일에 **2027-01-20** 이라고 적혀 있으면, 시스템은 그 날짜를 그대로 DB에 저장해야 합니다.
- 그런데 현재 코드는 브라우저의 로컬 시간대(예: 한국 KST)를 거치면서 **UTC 시간 기준으로 날짜를 재계산**하다가 하루가 밀립니다.
- 한국에서 업로드 시 `2027-01-20` → `2027-01-19` 로 저장됨. 도하(+03) 현지 PC에서만 우연히 정상 동작해서 발견이 늦었습니다.
- 해결: **Excel Date 셀은 연/월/일 숫자만 브라우저 로컬 구성요소로 읽어 `YYYY-MM-DD` 문자열로 조합**하고, 시간대 가감 계산을 제거합니다.

## 확인된 증거 (파일 vs DB, 15건 무작위 표본)

| ID | Excel planned_start | DB planned_start | Excel planned_closure | DB planned_closure |
|---|---|---|---|---|
| 29444 | 2026-07-09 | 2026-07-08 | 2026-07-19 | 2026-07-18 |
| 100309 | 2027-01-20 | 2027-01-19 | 2027-01-25 | 2027-01-24 |
| 111894 | 2027-07-06 | 2027-07-05 | 2027-07-11 | 2027-07-10 |
| 112453 | 2026-10-21 | 2026-10-20 | 2026-10-26 | 2026-10-25 |
| 65253 | 2026-08-01 | 2026-07-31 | 2026-08-11 | 2026-08-10 |
| 87820 | 2026-10-08 | 2026-10-07 | 2026-10-13 | 2026-10-12 |

모든 `planned_*` 날짜 컬럼이 정확히 −1일. 반면 `created_date`(문자열 타임스탬프), `due_by`(문자열 YYYY-MM-DD)는 정확히 일치 → 오차는 **Excel 순수 날짜 셀에만** 발생.

## 저장 형식(중요)

- Postgres `date` 컬럼(`planned_start_date` 등)은 순수 날짜 타입이며 시간대 개념이 없습니다.
- 파서가 넘겨주는 값이 `"YYYY-MM-DD"` 문자열이면 Supabase 클라이언트가 자동으로 `date` 타입으로 정확히 캐스팅합니다.
- 따라서 **파서 출력은 `YYYY-MM-DD` 문자열, DB에는 `date` 타입**으로 저장되어 내부 판정 로직·필터·엑셀 Export 시 모두 날짜 속성으로 사용됩니다. (별도 명시적 `Date` 객체 변환 불필요; 오히려 `Date`로 감싸면 다시 시간대 문제가 발생함.)
- Export 시에도 문자열이 아니라 진짜 `date` 값을 읽어 엑셀의 날짜 셀로 출력됩니다.

## 수정 항목

### 1. SM 파서 수정 (핵심)
`src/lib/defect-management/parser.ts` — `toIsoDate()` 의 `Date` 분기:

- **현재(잘못)**: `toDohaDateKey(v)` 호출 → 내부에서 `getTime() + 3h` → `.toISOString().slice(0,10)`
- **수정 후**: `v.getFullYear()` / `v.getMonth()+1` / `v.getDate()` 만 사용해서 `` `${y}-${MM}-${dd}` `` 로 조립
- 결과 문자열은 DB `date` 컬럼에 그대로 저장되고, 조회 시 자동으로 date 타입.

`toIsoDateTime()` 은 이미 로컬 구성요소를 쓰고 있어 수정 불필요.

### 2. 다른 모듈 동일 취약점 점검·수정
동일 패턴 여부 확인 후 필요한 곳만 수정:
- `src/lib/task-management/parser.ts`
- `src/lib/abd/parser.ts`
- `src/lib/spare-part-import-parser.ts`
- `src/lib/dmr-parse.functions.ts`

문자열(YYYY-MM-DD, DD/MM/YYYY)·Excel serial number 분기는 이미 로컬 계산이라 유지.

### 3. 회귀 방지 테스트
`src/lib/defect-management/__tests__/parser.date.test.ts` (Vitest) 추가:
- 브라우저 TZ를 KST(+09) / UTC / Doha(+03) 로 각각 스텁
- Excel Date 셀 / Excel serial number / YYYY-MM-DD 문자열 / DD/MM/YYYY 문자열 4 케이스 모두 동일 결과 반환 확인

### 4. 기존 저장분 처리
- 배포 후 최신 파일을 **재임포트하면 upsert 로 자동 정정**됩니다(권장).
- 별도 대량 마이그레이션은 이 계획에 포함하지 않음. 필요하시면 특정 upload 배치 범위를 지정해 `date + 1` 백필 스크립트를 별도로 요청해 주세요.

## 검증 절차
1. 수정 배포 후 동일 파일을 SM에 재임포트.
2. 위 15개 ID의 `planned_start_date`, `planned_rectified_date`, `planned_closure_date` 재조회 → 파일과 완전 일치 확인.
3. `date` 타입으로 저장되었는지 확인(정렬·범위 필터·엑셀 Export 시 날짜 셀로 출력).
4. TM/ABD/Spare Part/DMR 대표 파일 각 1개씩 재임포트하여 5건 샘플 비교.

## 원칙 (재발 방지)
- xlsx `cellDates:true` 로 얻은 `Date` 는 "브라우저 로컬 시간의 벽시계 값" 이다.
- 순수 날짜(day-only)는 **로컬 연/월/일만 읽어 `YYYY-MM-DD` 문자열로 조립** → DB `date` 컬럼에 그대로 저장.
- `getTime()` 기반 시간대 가감을 pure-date 처리에 절대 사용하지 말 것. 이 규칙을 `src/lib/time/doha.ts` 헤더 주석에 명시.
