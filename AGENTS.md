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
