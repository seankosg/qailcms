## 배경

- 신규 HDEC 파일(`ABD_Status_MECH_260725-2.xlsx`)은 스테이지 밴드에 라운드 숫자가 결합됨: `DS1/DF1/SB1/RS1`, `DS2/DF2/SB2/RS2`, `DS3/DF3/SB3/RS3`.
- 일부 라운드는 `PLAN/ACTUAL` 앵커 셀이 병합·공백이라, 위치 기반 폴백이 필요.
- `latest_status`와 `r{n}_dar_actual`(RS ACTUAL)는 **HDEC와 Aconex가 서로 덮어쓰는 필드**임을 사용자가 확정 — 보호/우선순위 로직 없음, 사용자가 선택한 파일의 마지막 임포트 값이 최종.

## 변경 사항

### 1) `src/lib/abd/parser.ts` (~30줄)
- **스테이지 밴드 라운드 추출**: `DS/DF/SB/RS` 뒤에 붙는 숫자를 정규식(`/^(DS|DF|SB|RS)\s*([1-3])$/i`)으로 우선 파싱 → 라운드 결정.
  - 밴드에 숫자가 없으면 기존 로직(상위 `ROUND n` 헤더)으로 폴백 → 레거시 파일 호환.
- **PLAN/ACTUAL 앵커 공백 보완**: 스테이지 밴드 범위 내 앵커 행이 비어 있으면 컬럼 순서 기반(첫 번째 = PLAN, 두 번째 = ACTUAL)으로 자동 할당.
- `STAGE_TO_KEY` (DS→draft_start, DF→draft_finish, SB→submission, RS→dar) 매핑은 그대로 유지.

### 2) `src/lib/abd/mutations.functions.ts` — **변경 없음**
- `latest_status`, `r{n}_dar_actual`는 사용자가 선택한 필드만 payload에 담아 upsert → HDEC/Aconex 상호 덮어쓰기 정상 동작.
- 별도 우선순위·보호 로직 미도입.

### 3) `src/lib/abd/aconex-import.functions.ts` — **변경 없음**

## 검증
- Plot 3·Plot 4 각 라운드 4스테이지 PLAN/ACTUAL 8쌍/12쌍 필드가 모두 정상 매핑되는지 임포트 프리뷰로 확인.
- 레거시 HDEC 파일(`ROUND 1` 헤더 + 명시적 PLAN/ACTUAL)도 정상 임포트.
- HDEC → Aconex 순 임포트 시 Aconex 값이 최종, Aconex → HDEC 순 임포트 시 HDEC 값이 최종.

## 영향 범위
- 변경 파일: `src/lib/abd/parser.ts` 1개.
- DB 스키마 / RPC / 대시보드 / 트리거 / mutations / Aconex 코드 **변경 없음**.
