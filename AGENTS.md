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

원칙: 목록 조회 RPC는 **행별 반환**(`RETURNS TABLE`, 한 record = 한 row)을 기본으로 한다. 한 번의 `jsonb_agg`로 전체 결과를 감싼 "단일 jsonb 배열" 반환은 금지 — 클라이언트가 조용히 잘림(silent truncation)을 놓치고, PostgREST 응답 상한(1,000행) 트리거 시 청크 루프도 불가능해진다.

**표준 예외 — "페이지 행수 가변 검색" RPC**:
`RETURNS TABLE(rows jsonb, total_count bigint)` 형태(record당 하나의 `to_jsonb(원행)` + 전체 총계 동반)는 허용된다. 사유:

1. 한 번의 호출로 페이지 행 + 총계를 원자적으로 반환해 프론트가 pagination/UX(총건수·잘림 감시)를 안정적으로 수행할 수 있음
2. `rows`는 여전히 record-per-row(하나의 원본 행)이므로 PostgREST 상한과 청크 루프 계약이 유지됨
3. 클라이언트는 `rows.length` vs `total_count` 대조로 잘림을 감시해야 하며(`src/lib/data/assertNoSilentTruncation.ts`), `rows`가 배열/`null`/비-object로 오면 즉시 실패 처리한다

선례: `abd_items_search`, `defect_items_search`, `tm_items_search`.
