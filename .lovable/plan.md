# 스티키 컬럼 불투명 정책 저장 및 ABD Raw Data 적용

## 배경
현재 `src/components/abd/raw-data/AbdRawDataPage.tsx`의 스티키 셀 배경은 `stickyBg()` 함수가 `linear-gradient(base,base), hsl(var(--muted)/0.95)` 처럼 반환합니다. CSS `background` shorthand의 다중 레이어 문법에서 마지막 레이어를 제외하면 각 레이어는 `background-image` 여야 하는데, 뒤쪽 `hsl(... / 0.95)` 는 이미지가 아닌 색 값이라 문법이 어긋나 브라우저에 따라 레이어가 무시되거나 뒤 컬럼이 비쳐 보일 수 있습니다. 또 `inactive` 행은 반투명 `bg-muted/30` 이 TableRow에 적용돼 스티키 셀만 배경이 어긋나 보입니다.

## 변경 사항

### 1) 메모리 저장 (프로젝트 전역 규칙)
- `mem://design/sticky-columns-opaque` 를 새로 만들고, `mem://index.md` Core 섹션에 한 줄 요약 추가.
- 요약: "모든 Raw Data 테이블의 스티키(고정) 컬럼은 항상 100% 불투명 배경을 사용한다. 뒤쪽 컬럼이 비쳐 보이지 않도록 반투명 배경/오버레이는 두 개의 `linear-gradient()` 레이어로 쌓아 완전 불투명을 보장한다."

### 2) `src/components/abd/raw-data/AbdRawDataPage.tsx` 수정
`stickyBg(row, index)` 를 다음 규칙으로 재작성:

- 기본 불투명 베이스: `hsl(var(--background))`
- 상태별 오버레이(전부 gradient 레이어로 감싸 불투명 스택 구성):
  - hover: `linear-gradient(hsl(var(--muted)/0.5), hsl(var(--muted)/0.5)), linear-gradient(hsl(var(--background)), hsl(var(--background)))`
  - inactive (그리고 hover 아님): `linear-gradient(hsl(var(--muted)/0.3), hsl(var(--muted)/0.3)), linear-gradient(hsl(var(--background)), hsl(var(--background)))`
  - 그 외: `hsl(var(--background))`
- 이렇게 하면 오버레이가 반투명이어도 밑에 완전 불투명 베이스 레이어가 깔려 뒤 컬럼이 절대 비치지 않습니다. 시각적으로는 기존 TableRow의 `hover:bg-muted/50`, `bg-muted/30` (inactive) 톤과 일치합니다.

헤더 쪽 스티키 (`originStyle.stickyBg`)는 이미 알파 없는 hsl 색을 쓰므로 그대로 두되, 코멘트로 "불투명 유지 필수" 명시.

### 3) 검증
- `bunx tsgo --noEmit` 타입 체크
- 프리뷰에서 ABD Raw Data 화면을 가로 스크롤해 스티키 컬럼(체크박스/ABD_NUMBER 등)이 뒤 컬럼과 겹치지 않는지 확인
