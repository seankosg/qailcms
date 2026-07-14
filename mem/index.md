# Project Memory

## Core
지시사항을 축약/생략/변경하려 할 때는 반드시 사전에 사용자에게 확인. 임의 판단으로 스코프 축소나 다른 방식 대체 금지. 특히 "@project 의 X를 반영/포팅"이라는 지시는 UI/기능/데이터 흐름을 원본 그대로 이식하는 뜻이며 단순화 금지.
테이블 스티키 컬럼은 항상 완전 불투명 배경(반투명 금지). 인라인 style은 `var(--background)` + `color-mix(in oklab, ...)` 사용, `hsl(var(--token))` 래핑 금지.

## Memories
- [Sticky columns opaque](mem://design/sticky-columns-opaque) — 테이블 스티키 컬럼 배경 불투명화 규칙 및 oklch 토큰 사용 시 주의사항