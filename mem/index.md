# Project Memory

## Core
지시사항을 축약/생략/변경하려 할 때는 반드시 사전에 사용자에게 확인. 임의 판단으로 스코프 축소나 다른 방식 대체 금지. 특히 "@project 의 X를 반영/포팅"이라는 지시는 UI/기능/데이터 흐름을 원본 그대로 이식하는 뜻이며 단순화 금지.
테이블 스티키 컬럼은 항상 완전 불투명 배경(반투명 금지). 인라인 style은 `var(--background)` + `color-mix(in oklab, ...)` 사용, `hsl(var(--token))` 래핑 금지.
TM은 As-of 예외: Actual%·완료는 기준일 무관 불변, Plan%·판정만 기준일 함수. 완료 정본 = actual_finish 단독. 기준일 기본값=어제.
검증 게이트는 절대 수치가 아니라 등식으로 건다(합=count(*)). "0건"에는 항상 모집단을 병기한다.

## Memories
- [Sticky columns opaque](mem://design/sticky-columns-opaque) — 테이블 스티키 컬럼 배경 불투명화 규칙 및 oklch 토큰 사용 시 주의사항
- [TM 실적 체계 정책](mem://features/tm-actuals-policy) — TM As-of 예외, 완료 정본·기준일·자동채움 트리거·곡선 규칙, 검증 방법론, HDEC 양식 근본원인