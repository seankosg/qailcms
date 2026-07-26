# ABD Raw Data 필터 → TM 크로스필터 이식

## 목표

ABD Raw Data의 컬럼 필터 드롭다운을 TM Raw Data와 **동일한 크로스필터 동작·UI·타입 커버리지**로 통일한다. 자기 필터만 제외하고 team·status·plot·검색어·다른 컬럼 필터가 모두 옵션 목록과 카운트에 실시간 반영되며, 0건 옵션은 숨긴다.

## 현재 상태 요약 (확인 완료)

- ABD `useAbdFacet`(`src/hooks/useAbdItems.ts:98-137`)은 **이미 자기 컬럼을 제외한 다른 필터·team·status·plot·q를 서버로 넘긴다.** 훅 자체는 크로스필터 규칙과 동일함.
- 서버 RPC `abd_items_facets`(`supabase/migrations/20260726070306_*.sql:147-253`)도 동일 규칙 준수. 단 **비어있음(NULL/'')은 group에서 제외**하여 `(Empty)` 카운트를 반환하지 않음.
- `AbdMultiSelectDropdown`(`src/components/abd/raw-data/AbdColumnFilterDropdowns.tsx:43-51`)은
  - `options` prop(정적 전체 목록)을 서버 facet에 병합해 **0건 옵션을 항상 노출** → 사용자가 "카운트가 안 바뀐다"고 체감하는 주 원인.
  - `(Empty)` 카운트를 하드코딩 0으로 표시.
  - 정렬이 라벨 asc → TM은 카운트 desc, 값 asc.
  - `Select all`은 `filteredItems` 대상 (TM과 동일).
- 타입 커버리지: ABD는 `multi-select / date-range / text`만 제공. TM은 추가로 `number-range`, `stage-progress` 존재.

## 변경 범위

### 1) DB — `(Empty)` 카운트 지원

`supabase/migrations/`에 새 마이그레이션 추가하여 `abd_items_facets`가 `(Empty)` 그룹을 함께 반환:

```sql
-- group by 절 전 UNION ALL로 empty count 합산
select value, cnt from (
  select %I::text as value, count(*)::bigint as cnt
    from public.abd_items_raw where %s and %I is not null and %I::text <> ''
    group by %I
  union all
  select '__EMPTY__'::text, count(*)::bigint
    from public.abd_items_raw where %s and (%I is null or %I::text = '')
) t
order by (value = '__EMPTY__') asc, cnt desc, value asc
limit %s
```

프론트는 `EMPTY_TOKEN` (`src/lib/abd/filter-fns.ts` 기존값)과 일치시켜 매핑.

### 2) 프론트 — `AbdMultiSelectDropdown` TM 화(化)

`src/components/abd/raw-data/AbdColumnFilterDropdowns.tsx`

- **옵션 소스를 서버 facet 전용으로 전환**: 정적 `options` prop은 라벨 매핑용 dictionary로만 사용하고 목록에는 병합하지 않음 → 0건 옵션 자연 소거.
- `(Empty)`는 서버가 반환한 empty 카운트가 0이면 숨김. 사용자가 이미 선택한 값은 카운트 0이어도 유지 노출 (TM과 동일).
- 정렬을 TM과 일치: 카운트 desc → 값 asc, `(Empty)`는 최상단.
- 카운트 뱃지 스타일·행 hover·(Empty) 흐림 처리 등 TM `MultiSelectDropdown` 시각과 픽셀 톤 통일.
- 로딩 중 스켈레톤 한 줄 표시(현재 없음) — 서버 응답 대기 UX 개선.

### 3) 프론트 — TM 타입 이식

ABD에 없는 두 타입을 신설:

- `AbdNumberRangeDropdown` — TM `NumberRangeDropdown`과 동일 UX. 서버는 이미 `num_range` op 지원.
- `AbdStageProgressDropdown` — TM 스타일 3섹션(Start/Alarm/Finish). ABD는 라운드 기반이라 완전 동일하진 않으므로 **1차는 스캐폴딩만 배치하고 실제 컬럼에 연결하지 않음**. 활성 대상 컬럼이 정해질 때 meta에서 `filterType: "stage-progress"` 선언으로 켤 수 있게 훅업.
  - (이 항목은 사용자 확인 후 실제 컬럼에 연결. 현재 ABD 컬럼 정의에 `stage-progress` 대상이 없음.)

`AbdColumnFilterDropdown` 스위치에 `number-range`, `stage-progress` 케이스 추가.

### 4) 방어 로직

- Dev 경고: `useAbdFacet`이 `otherFilters` 계산 후 `column === undefined`이거나 결과가 오래 stale일 때 콘솔 힌트.
- Popover가 다시 열릴 때 최신 필터 스냅샷을 확실히 재요청하도록 `staleTime`을 60s → 15s로 낮추고, `refetchOnMount: "always"`로 크로스필터 지연 체감 제거.

## 기술 상세

- 서버 함수 시그니처 유지, 반환 컬럼 이름 `value/cnt` 유지 → 클라 훅 변경 최소화.
- `EMPTY_TOKEN`은 프론트 상수와 SQL의 `'__EMPTY__'`가 문자열 일치해야 함. 현재 프론트 값 확인 후 SQL 리터럴을 맞춤.
- TM의 `getFacetedRowModel` 흐름을 그대로 옮기지 않음 — ABD는 서버 페이지네이션 데이터라 클라이언트 faceted 모델을 만들 원본이 없다. 대신 **서버 RPC가 이미 정확한 크로스카운트를 제공**하므로 프론트는 소비만 개선.

## 영향 없는 것

- ABD 라우트 스키마, URL 파라미터, 팀/status/plot 토글 로직은 그대로.
- Dashboard/Progress/Attention 등 타 페이지 무관.
- TM 파일은 편집하지 않음(참조만).

## 파일 목록

- 수정: `src/components/abd/raw-data/AbdColumnFilterDropdowns.tsx`, `src/hooks/useAbdItems.ts` (staleTime/refetch 정책)
- 신규: `supabase/migrations/<ts>_abd_facets_include_empty.sql`

## 검증

1. ABD Raw Data에서 team=MECH 선택 → `dis` 드롭다운을 열면 MECH에 존재하는 값만 표기되고 카운트가 실제 필터 결과와 일치.
2. `hdec_pic_name`을 선택 → `doc_ax` 옵션 목록이 그 PIC의 도면 값만으로 즉시 좁혀짐(0건은 사라짐, 이미 선택된 값은 유지).
3. 검색어 입력 후 다른 컬럼 드롭다운 오픈 → 검색 반영된 카운트가 표시.
4. 비어있는 값이 있는 컬럼은 `(Empty) · N` 표기, 없으면 항목 숨김.
