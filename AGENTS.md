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
