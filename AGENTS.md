<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## 프로젝트 운영 규칙

### 설계 변경 사전 보고 원칙 (필수)

승인된 설계·범위를 변경하려는 경우 **시행 전 사용자 확인이 필수**다. 다음을 포함하되 이에 한정되지 않는다:

- 데이터 모델(테이블·컬럼·enum·제약)의 추가/삭제/의미 변경
- 승인된 UI 카드·필드·슬롯 수의 증감(예: Plot 슬롯 6→9)
- 판정식·집계식·라운드/스테이지 수식의 변경
- 임포트/파서 규칙의 확장(예: 자동 유도 로직 추가) — 방어 목적이라도 사전 보고

절차:
1. 변경 사유·범위·영향 파일 목록을 사전 보고
2. 사용자 승인 대기
3. 승인 후에만 시행, 시행 결과를 실측치와 함께 보고

"방어 목적", "명백한 개선", "사용자가 원할 것"이라는 자체 판단으로 사전 보고를 생략하지 않는다.

### 참조 프로젝트 실측 원칙

"X와 동일하게 / 이식 / 포팅" 유형 지시는 반드시 참조 프로젝트 원본 파일을 **파일:라인 인용**으로 실측한 뒤 현재 구현 대비 diff 표를 제출한다. 파일 존재 확인만으로 "구현 완료" 판정 금지. 참조 프로젝트명은 사용자 화면(UI 문구·카드명·툴팁)에 노출하지 않는다.

### RPC 반환 계약 규칙

확정 정책 (2026-07-27 실측 검증):

1. **행수 상한(1,000 미만)이 보장되는 조회 = 행별 반환 허용.**
   - `RETURNS TABLE(...)` 사용. 예: facets RPC(축당 ≤ 수십~수백), 마스터 리스트 등.
   - 상한이 SQL 내부 `limit` 로 명확히 보장되어야 함.
   - 선례: `abd_items_search`, `defect_items_search`(행별 TABLE + 클라이언트 청크 페칭 방식), `tm_items_facets`.

2. **페이지 행수 가변 검색·대량 조회 = jsonb 단일 값 반환.**
   - `RETURNS jsonb` 로 `{rows, total_count, ...}` 등을 스칼라로 반환.
   - scalar 반환이므로 PostgREST 응답 행 상한(1,000)이 비적용됨(2026-07-27 실측 검증 완료).
   - 페이지 행수가 필터에 따라 가변이거나, 매칭 ID 전체를 반환해야 하는 경우가 대상.
   - 선례: `tm_items_search`(rows/total_count/main_count), `tm_items_search_ids`·`defect_items_search_ids`(id 문자열 배열), `abd_items_by_numbers`, `abd_judge_at_date`.

3. 클라이언트 잘림 감시 의무는 유지된다.
   - jsonb 스칼라 응답이라도 `rows.length` vs `total_count` 대조, 배열/`null`/비-object 형식 실패 처리(`src/lib/data/assertNoSilentTruncation.ts`).
   - 상한이 보장되는 행별 반환 RPC도 상한 근접 시 경보를 남긴다.

### RPC 시그니처 변경 규칙 (필수)

기존 RPC에 파라미터를 추가/삭제/타입 변경할 때는 **같은 마이그레이션에 구 시그니처 DROP FUNCTION 을 반드시 포함**한다.

- `CREATE OR REPLACE FUNCTION` 은 시그니처가 다르면 새 함수를 만들고 옛 함수를 남긴다. 두 오버로드가 공존하면 PostgREST 는 후보를 결정하지 못해 `PGRST203` (ambiguous function) 로 실패한다.
- 마이그레이션은 다음 순서로 작성한다: (1) `DROP FUNCTION IF EXISTS public.<name>(<옛 인자 시그니처>);` (2) 신 시그니처 `CREATE OR REPLACE FUNCTION`.
- 새 파라미터는 기본값(default)을 부여해 기존 클라이언트 호출이 신버전 하나에만 유일 매칭되도록 한다.
- 배포 후 `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = '<name>'` 로 오버로드가 1건인지 실측 확인.
- 선례: 2026-07-28 `tm_items_search` / `tm_items_search_ids` / `tm_items_facets` 확장 시 구 시그니처 DROP 누락으로 TM Raw Data 로딩 중단 → 후속 마이그레이션으로 복구.

### 효율화 라운드 UI 불변 원칙 (필수)

효율화(성능/서버 페이지네이션/RPC 리팩터 등) 라운드 중에는 **UI 요소·배치·문구·상호작용을 절대 변경하지 않는다**. 목적은 내부 데이터 파이프라인 교체이며, 사용자가 관찰 가능한 표면은 100% 동등해야 한다.

금지 대상(예시, 한정 아님):
- 컬럼 순서·라벨·너비·고정 여부·정렬 기본값
- 필터 UI(칩·드롭다운·범위 입력)의 위치·동작·연산자
- 페이지네이션/스크롤/가상화 UX(예: 무한 스크롤 ↔ 페이지 버튼 전환)
- 대량 선택·Export·Bulk Edit 진입 경로 및 결과 파일 규칙
- 상태 배지·색상·아이콘 등 시각 토큰

절차 위반 발견 시 즉시 롤백하고 별도 UI 변경 티켓으로 분리한다. 예외적으로 내부 리팩터 결과 UI 파생물(예: "행 로드됨" 안내 문구 위치)이 불가피하게 이동되어야 한다면, 라운드 시행 전 사전 보고 후 승인받는다.

### today_actual/today_gap 서버 정렬 처리 (확정)

오늘 실적/갭 컬럼의 서버 정렬 통합은 페이지 스코프 정렬로 충분하다는 실측 판단 하에 **현행 클라이언트 페이지 내 정렬을 유지**한다. LATERAL 조인을 통한 뷰/RPC 통합안(`_as_of` 파라미터 도입)은 `BACKLOG.md` 항목 #10에 등재하며, 페이지 스코프 정렬로 부족한 시나리오 발견 시에만 재개한다.

### RPC 필터/정렬 허용 컬럼 규칙 (확정)

검색/패싯 계열 RPC(`*_items_search`, `*_items_facets`, `*_items_search_ids`)의 필터·정렬 컬럼 검증은 **하드코딩 `_allowed_cols` 배열을 두지 않는다**. `information_schema.columns`에서 대상 원본 테이블의 컬럼을 런타임 유도한 목록에 파생 컬럼 화이트리스트(예: `public.abd_derived_cols()`)를 합쳐 사용한다. 목록에 없는 컬럼이 오면 **조용히 무시하지 말고 `RAISE EXCEPTION`으로 즉시 실패**시켜 클라이언트에 표면화한다. 파생 컬럼 추가/제거 시 해당 모듈의 `*_derived_cols()` 배열을 반드시 갱신한다(각 함수 상단 주석에도 동일 규칙 명시). 2026-07-29 ABD(`abd_items_search`, `abd_items_facets`)에 최초 적용.

### TM 신규 화면 정본 경유 원칙 (필수, 2026-08-01)

TM 모듈에 신규 카드·차트·필터·표를 추가할 때는 **반드시 `tm_rows_as_of`(또는 그 jsonb 래퍼 `tm_rows_as_of_json`) + 정본 판정 함수(`tm_row_gap` / `tm_kpi_judgment_g`)를 경유**한다.

금지:
- `task_management_raw` 또는 `v_task_management_raw_derived` 직조회 후 클라이언트에서 Plan%·Gap·판정을 재계산해 새 화면을 만드는 것
- 저장된 `auto_judgment` 스냅샷을 판정 소스로 사용하는 것
- Main 과업 판정에 자기 창(self-window) 계획을 쓰는 것 — Main 은 하위 가중 계획(`tm_main_tplan`) 정본을 따른다

클라이언트 계산 함수(`derived.ts`)는 서버 정본 값이 없을 때의 **폴백 전용**이며, 서버 병합 필드(`srv_judgment`/`srv_plan_pct`/`srv_actual_pct`)가 있으면 항상 그것이 우선한다(`delay-utils.ts`의 `resolveJudgment`/`resolveIsDelayed`).
