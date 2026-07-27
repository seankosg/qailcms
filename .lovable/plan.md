## 목표
`abd_items_search` 반환 shape만 SM/Defect와 동일한 행별 반환으로 원복. 상태 그룹/딜레이 버킷 매핑 로직(173246의 의도된 변경)은 그대로 유지.

## 173246 vs 172932 diff 결과 (사전 검증)
- 총 45라인 차이, 전부 `delay_bucket` 배열 값 매핑(RS_DELAY→RS, SB_DELAY→SB, DS_DELAY→DS, needs_planning→NoPlan)뿐.
- 정렬 기본값 `sl_no asc NULLS LAST`, OFFSET/LIMIT, 필터 파서, 컬럼 화이트리스트, GRANT — 모두 동일.
- 즉 반환부(`SELECT coalesce(jsonb_agg(...))`)만 손대면 되고, 부수적으로 되돌려야 할 것은 없음.

## 변경

### 1. 새 migration 1개 — `abd_items_search` 반환 shape만 원복
현재 173246 함수 정의를 그대로 복제하고 마지막 SELECT를 아래로 교체:

```sql
_sql := format($q$
  WITH filtered AS (
    SELECT * FROM abd_items_raw WHERE %s
  ), counted AS (
    SELECT count(*)::bigint AS c FROM filtered
  ), paged AS (
    SELECT * FROM filtered ORDER BY %s OFFSET %s LIMIT %s
  )
  SELECT to_jsonb(p.*) AS rows, (SELECT c FROM counted) AS total_count
  FROM paged p
$q$, _where, _sort_sql, _offset, _limit);
```

함수 상단에 한 줄 주석 추가:
> Returns one row per item. `rows` = to_jsonb(record), `total_count` repeated on every row. Matches defect_items_search / SM contract. Do not change this shape without also updating useAbdItems.ts.

그 외 로직(상태 그룹 매핑, 딜레이 버킷 매핑, 필터, 정렬, 컬럼 화이트리스트)은 173246과 100% 동일하게 유지.

### 2. `src/hooks/useAbdItems.ts` — 엄격 검증만 추가
`useAbdItemsQuery` queryFn에서 응답 파싱 직전에:
```ts
if (Array.isArray(data) && data.length > 0) {
  const first = data[0] as any;
  if (first && typeof first.rows !== "object") {
    throw new Error(
      "abd_items_search RPC contract mismatch: expected row-per-record { rows: object, total_count }, got rows=" +
      (Array.isArray(first.rows) ? "array" : typeof first.rows)
    );
  }
}
```
기존 `arr.map((r) => r.rows as AbdItem)` 로직은 유지. normalizer는 도입하지 않음.

## 하지 않을 것
- 양쪽 shape 수용 normalizer.
- ABD 외 훅/컴포넌트 수정, 딥링크·컬럼 설정 방어 로직.
- 173246의 딜레이 버킷 매핑 로직 손대기.

## 검증
1. `/closure/abd/raw-data?tab=MECH&pageSize=100`: 첫 행에 ABD Number/Plot/DIS/Latest Status 실제 값 표시 + 카운트 `2,606 records` 일치.
2. 같은 화면 pageSize=ALL: 렌더/카운트 일치.

두 확인만 통과하면 종료.