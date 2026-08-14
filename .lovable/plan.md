# DMR 대시보드 로딩 속도 개선안 (정본 불변)

## 실측 (2026-08-14 기준, 서버 응답만)

| 호출 | 1회 시간 | 페이로드 | 화면당 횟수 |
| --- | --- | --- | --- |
| `tm_rows_as_of_json(끝일)` | 3.3s | 3.6MB | 1 |
| `tm_rows_as_of_json(시작−1)` | 3.3s | 3.6MB | 1 (누계 전체 제외) |
| `tm_actual_at_set` × 2 | 0.2s | 소 | 2 |
| `tm_rows_as_of(날짜별, 1,000행 청크)` | 1.75s | — | **날짜수 × 2청크** (월 단위 = 최대 62회, 동시 4 → 약 25~30초) |
| `dmr_entries` 페이지 조회 | 빠름 | — | 1~n |

결론: 느린 원인은 계산식이 아니라 **왕복 횟수와 페이로드**다. 특히 추이 차트의 날짜별 반복 호출이 전체 지연의 대부분이다.

## 원칙

산식·판정 정본은 그대로 둔다. `tm_rows_as_of` / `tm_actual_at_set` 은 **여전히 유일한 진실**이며, 새로 만드는 것은 그 정본을 **서버 안에서 감싸 집계·전송량만 줄이는 래퍼**다. 클라이언트 산식(`productivity.ts`)은 입력 형식만 바뀌고 계산 로직은 유지한다. UI 는 전혀 바꾸지 않는다.

## 1) 날짜별 배치 RPC 신설 — `dmr_daily_canon(_start, _end)` (효과 최대)

- 반환: `jsonb` `{ "2026-08-01": { "TM-001": {p, a}, ... }, ... }`
- 서버에서 날짜 루프를 돌며 `tm_rows_as_of(d)` 의 `task_no, tc_plan_pct, tc_actual_pct` 세 열만 집계한다(정본 함수 그대로 호출).
- 왕복 62회 → **1회**, 전송량 수십 MB → 수백 KB.
- 클라이언트 `useDailyCanon` 은 이 RPC 하나만 부르고 `fetchTmDaily` 루프를 제거한다. `DAILY_SERIES_MAX_DAYS` 31일 제한도 완화 가능(우선 유지, 별도 확인 후 조정).

## 2) 기간 집계 RPC 신설 — `dmr_period_canon(_start, _end, _from_zero)`

- 반환: `jsonb` `{ rows: [{task_no, task_name, row_type, discipline, plot, data_date, plan_end, plan_prev, actual_end, actual_prev}], total_count }`
- 지금 클라이언트가 3.6MB TM 전량 두 벌을 받아 만드는 `planPrevByCode` / `actualEndByCode` / `actualPrevByCode` 매핑을 **서버에서 만들어 필요한 6개 값만** 내려준다.
- 7.2MB → 약 200KB, 3.3s×2 → 1회 호출.
- `buildProductivity()` 는 그대로 두고, 입력을 이 RPC 결과로 채운다(계산 정본 불변).

## 3) 과거 시점 스냅샷 캐시 (선택, 2단계)

- 지난 날짜의 `tm_rows_as_of` 결과는 불변이다. `tm_asof_daily_cache(as_of date pk, payload jsonb, built_at)` 에 적재하고, 위 두 RPC 가 **오늘/미래만 실시간 계산**하도록 한다.
- 야간 배치(기존 스냅샷 잡에 붙임) + 최초 요청 시 lazy fill.
- 효과: 월/누계 조회가 사실상 즉시 응답. 캐시가 비어도 정본 계산으로 자동 폴백하므로 정합성 위험 없음.

## 4) 클라이언트 체감 개선 (UI 불변)

- `placeholderData: keepPreviousData` — 기준일·필터 변경 시 화면이 비지 않고 이전 값을 흐리게 유지.
- 추이 차트·상세 표를 기존 `LazySection` 으로 감싸 **보이는 순간에만** 일별 데이터 요청(상단 KPI 는 즉시 표시).
- KPI/품질/인원 카드는 1)·2) 중 **기간 RPC 하나만** 기다리게 분리 — 지금은 일별 조회와 같은 로딩 스켈레톤에 묶여 함께 늦어진다.
- `dmr_entries` 조회는 필요한 열만(이미 적용) + `report_date` 인덱스 확인.

## 예상 결과

| 구간 | 현재 | 개선 후 |
| --- | --- | --- |
| KPI·인원 카드 첫 표시 | 7~10초 | **1초 내외** |
| 월 단위 추이 차트 | 25~35초 | **2~4초** (캐시 적용 시 1초 미만) |

## 순서 제안

1. 2) 기간 집계 RPC → KPI 카드 즉시 개선
2. 4) 카드/차트 로딩 분리 + Lazy 마운트
3. 1) 날짜별 배치 RPC → 차트 개선
4. 3) 스냅샷 캐시 (필요 시)

각 단계는 독립 배포 가능하며, 단계마다 기존 화면 값과 **동일치 대조 검증**(같은 기준일에서 KPI 4장·품질 줄·차트 합계 일치)을 실측 보고한 뒤 다음으로 넘어간다.
