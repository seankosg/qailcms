---
name: 스티키 컬럼 배경 규칙
description: 테이블 스티키(frozen) 컬럼 셀 배경은 항상 완전 불투명. 반투명 금지.
type: design
---
테이블 스티키/frozen 컬럼(첫 컬럼 그룹)의 배경은 항상 완전 불투명이어야 한다. 스크롤 시 뒤 컬럼이 비쳐 보이면 안 된다.

- 인라인 style로 `background` 지정 시 프로젝트 컬러 토큰은 `oklch(...)` 리터럴이므로 `hsl(var(--token))` 로 감싸면 무효 값이 되어 배경이 painting 되지 않는다. `var(--background)` 를 그대로 쓸 것.
- 알파(tint)가 필요한 상태색(closed/overdue/hover)은 `hsl(... / 0.x)` 대신 `color-mix(in oklab, var(--token) N%, var(--background))` 로 합성해 최종 색을 불투명하게 만들 것.
- Tailwind 클래스로는 `bg-muted/30` 같은 알파 유틸을 스티키 컬럼 셀에 직접 쓰지 말 것 (행 클래스는 무관).

적용 위치 예: `src/components/defect-management/raw-data/DefectRawDataPage.tsx` 의 `stickyBgFor`.