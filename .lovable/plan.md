## 개선 목표
현재 사이드바 메뉴가 모두 비슷한 `text-sm` / `font-medium` / `text-foreground`로 출력되어, 섹션-모듈-메뉴 간 계층 구분이 모호합니다. **글자 크기, 굵기, 색상을 계층별로 다르게 적용**하여 한눈에 현재 위치와 메뉴 구조를 파악할 수 있도록 시인성을 높입니다.

## 개선 대상 파일
- `src/components/layout/AppLayout.tsx`
- Tailwind v4 토큰만 사용 (`src/styles.css`의 `--muted-foreground`, `--foreground`, `--primary` 등)

## 세부 디자인 적용안

### 1. Section Label (섹션 제목: "Outstanding Work", "Close-Out Doc", "Import & Log", "Admin")
- 글자 크기: `text-[11px]`
- 굵기: `font-bold`
- 색상: `text-muted-foreground`
- 자간: `tracking-wider`
- 변환: `uppercase`
- 위쪽 여백: `mt-4` → 섹션 간 그룹감 강화

### 2. Module Label (접을 수 있는 모듈: "Task Management", "Snag List Management", "As Built Drawing" 등)
- 글자 크기: `text-sm`
- 굵기: `font-semibold`
- 색상: `text-foreground`
- hover: `hover:text-primary`
- 아이콘: 모듈 아이콘은 `text-muted-foreground`, hover 시 `text-primary`

### 3. Dashboard / Flat Leaf (섹션 직속 메뉴: "Dashboard", "Import", "Import Logs", "Overview" 등)
- 글자 크기: `text-sm`
- 굵기: `font-medium`
- 색상: `text-foreground`
- hover: `hover:text-primary hover:bg-muted/50`

### 4. Module Sub Leaf (모듈 하위 메뉴: "Task Summary", "Raw Data", "Progress" 등)
- 글자 크기: `text-sm`
- 굵기: `font-normal` (상위와의 대비를 위해 Dashboard보다 한 단계 얇게)
- 색상: `text-foreground/80`
- hover: `hover:text-foreground hover:bg-muted/50`

### 5. Active 상태 강조
- active leaf: `text-primary font-semibold bg-primary/10`
- 왼쪽 액센트 바 추가: `border-l-2 border-primary pl-[calc(0.5rem-2px)]` (기존 `px-2`에서 2px 보정)
- active sub leaf: 상위와 동일, 배경색만 약하게

### 6. 모바일/미니 사이드바 호환
- 접힌 상태에서도 아이콘만 노출되므로 텍스트 스타일 변경은 PC 사이드바에만 영향
- 모바일 드로어에서도 동일한 계층 스타일 유지

## 구현 범위
- `renderLeaf()` 함수에 `level` 인자 추가 (`'dashboard' | 'sub'`)
- `module` 버튼에 module-level 클래스 적용
- `section` 라벨에 section-level 클래스 적용
- 기존 shadcn 토큰만 사용, 새로운 CSS 변수는 추가하지 않음

## 검증
- `bun run typecheck` 또는 `tsgo` 통과
- 브라우저 프리뷰에서 사이드바 캡처로 각 계층의 크기/굵기/색상 차이 확인
- active/hover 상태 정상 동작 확인

## 예상 결과
- Section → Module → Leaf 간 명확한 시각적 계층
- 현재 메뉴(primary + 배경)가 더 뚜렷하게 구분
- 모듈과 하위 메뉴의 종속 관계가 한눈에 들어옴