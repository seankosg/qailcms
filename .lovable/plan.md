
## 목표
원본 엑셀에 적힌 "타임존 표기 없는" 날짜·시각 값을 **도하 로컬(+03:00)** 로 해석하여 DB(UTC `timestamptz`)에 저장한다. 지금은 서버(런타임 UTC)에서 `new Date("2026-07-22 09:00")`을 UTC로 파싱하기 때문에, 사용자가 도하 09:00으로 적은 값이 실제로는 도하 12:00 시점으로 저장되어 3시간 어긋난다.

## 현재 상태(확인 결과)

- `src/lib/defect-management/parser.ts`
  - `toIsoDate()`: 순수 날짜(`YYYY-MM-DD`)만 반환하므로 이슈 없음. 유지.
  - `toIsoDateTime()`: 
    - 문자열은 `new Date(v).toISOString()` → 서버 UTC 기준으로 해석되어 어긋남.
    - Excel serial(숫자)은 `Date.UTC(y,m,d,H,M,S)` 로 만들고 `toISOString()` → 마찬가지로 어긋남.
    - `v instanceof Date` 는 XLSX `cellDates:true`가 로컬 미드나잇/시간으로 준 Date → `toISOString()` 시 서버 UTC로 해석되어 어긋남.
- `src/lib/task-management/parser.ts`, `src/lib/abd/parser.ts`, `src/lib/spare-part-import-parser.ts`
  - `toIsoDate()` / `normalizeDate()` 는 `YYYY-MM-DD`만 뽑음. 로컬/`getFullYear` 경로여서 캘린더 날짜는 문제 없음. **유지.**
  - 이 세 모듈에는 시각(HH:mm)이 붙는 datetime 임포트 필드가 없다(감사 타임스탬프 `created_at/updated_at`은 DB `now()` 기본값이라 파서와 무관).
- 결론: 실제 시프트 문제가 발생하는 파서는 **SM(`defect-management/parser.ts`)의 `toIsoDateTime` 한 곳**뿐이다. 다른 모듈은 date-only 이므로 손대지 않는다.

## 변경 범위

### 1) `src/lib/time/doha.ts` — 헬퍼 1개 추가
```ts
/** 타임존 없는 wall-clock 성분(YMDhms)을 Doha(+03:00) 기준으로 UTC ISO로 변환 */
export function dohaWallToUtcIso(
  y: number, m: number, d: number,
  h = 0, min = 0, s = 0
): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mi = String(min).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return new Date(`${y}-${mm}-${dd}T${hh}:${mi}:${ss}+03:00`).toISOString();
}
```

### 2) `src/lib/defect-management/parser.ts` — `toIsoDateTime` 재작성

원본에 타임존이 명시되어 있으면 그대로 존중, 없으면 Doha로 해석한다.

- `v instanceof Date` (XLSX cellDates:true 결과)  
  → `getFullYear/Month/Date/Hours/Minutes/Seconds` 로 벽시계 성분을 뽑아 `dohaWallToUtcIso(...)`.
- `typeof v === "number"` (Excel serial)  
  → 기존 `XLSX.SSF.parse_date_code(v)`로 `{y,m,d,H,M,S}` 얻고 → `dohaWallToUtcIso(...)`. (기존 `Date.UTC` 사용 라인 삭제)
- `typeof v === "string"`  
  → 문자열에 명시적 타임존(`Z` 또는 `±HH:MM`)이 있으면 `new Date(s).toISOString()` 그대로.  
  → 없으면 `YYYY-MM-DD[ T]HH:mm(:ss)?` 정규식으로 성분 추출 후 `dohaWallToUtcIso(...)`.  
  → 파싱 실패 시 `null`.

### 3) 회귀 방지 확인
- SM raw data 상에서 이미 저장된 값은 그대로 두고, **향후 임포트부터** 도하 기준으로 저장. (과거 값 마이그레이션은 이번 스코프 아님 — 필요 시 별도 요청)
- `formatDohaDateTime` 등 표시 로직은 이미 Asia/Qatar로 출력하므로 저장이 올바르면 화면도 자연스럽게 3시간 밀림 없이 표시됨.
- TM/ABD/SP 임포트는 date-only만 취급하므로 변경 없음. 캘린더 날짜는 지금도 정확.

## 검증
- 타입체크 통과 확인.
- 유닛 확인용 임시 로그로 다음 케이스가 아래와 같이 되는지 확인:
  - 문자열 `"2026-07-22 09:00"` → `2026-07-22T06:00:00.000Z`
  - 문자열 `"2026-07-22T09:00:00+03:00"` → `2026-07-22T06:00:00.000Z`
  - 문자열 `"2026-07-22T09:00:00Z"` → `2026-07-22T09:00:00.000Z` (원 타임존 존중)
  - Excel serial(도하 09:00 저장) → `2026-07-22T06:00:00.000Z`

## 스코프 밖(이번에 하지 않음)
- 기존 DB 값 소급 보정 마이그레이션
- date-only 필드를 datetime으로 재해석
- DMR 파싱 프롬프트/AI 결과 재해석 (문자열 저장 기반이라 별도 검토 필요)
