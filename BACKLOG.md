# ABD 정합성 BACKLOG (동결 항목)

본 문서는 2026-07-27 기준 사용자 지시에 따라 **동결(freeze) 결정**된 항목과 각 항목의 **확정 설계**를 기록한다. 향후 별도 승인 없이 진행 금지.

상태 표기: `[동결]` = 실행 보류, `[설계확정]` = 접근·스키마·쿼리까지 확정.

---

## 1. Step 5 — latest_status 정규화 (A/B/C/NYS 통합)  `[동결]` `[설계확정]`

- **동결 사유**: 사용자 최종 결정 "Step 5 진행하지 않는다 — 동결이 최종 결정" (2026-07-27).
- **범위**: `abd_items_raw.latest_status` 원본 텍스트 정규화. `UR`, `NOT YET SUBMITTED`, 공백, 대소문자 변형 등을 정규 4코드(A/B/C/NYS)로 매핑.
- **확정 설계**:
  - 정규 매핑: `A/APPROVED → A`, `B/APPROVED WITH COMMENTS → B`, `C/REJECTED → C`, `UR/NOT YET/NOT YET SUBMITTED/공백/NULL → NYS`.
  - 저장 위치: 원본 파괴 없이 `latest_status_norm` 컬럼(CHECK: `IN ('A','B','C','NYS')`)에 저장. `latest_status`는 원본 유지.
  - 실행 방식: 단일 트랜잭션 마이그레이션 + 사전 스냅샷 `abd_status_norm_snapshot_{yyyymmdd}` 생성 후 UPDATE.
  - 필터 UI: 대시보드/Raw Data 필터에서 UR/NOT YET/blank 항목 제거하고 `NYS` 단일 옵션으로 통합.
- **재개 조건**: 사용자 명시적 승인.

---

## 2. R4+ 라운드 스키마 확장 (R3-C 사각지대 838건 해소)  `[동결]` `[설계확정]`

- **동결 사유**: R4 설계 승인 후 실행 승인 미부여.
- **문제**: 현행 스키마 R1/R2/R3 3라운드 고정. R3-C 838건은 재제출 라운드 부재로 상태 진행 불가.
- **확정 설계**:
  - 스키마: `abd_items_raw`에 `r4_ds/r4_df/r4_sb/r4_rr` 및 `r5_*` 컬럼 추가. `AbdStageCode` enum에 `R4_DS/R4_DF/R4_SB/R4_RR/R5_*` 추가.
  - 트리거: `abd_compute_derived` 라운드 파라미터화(`_rounds := ARRAY[1..5]`). 각 라운드 판정 로직 동일 패턴 반복.
  - 하이브리드: R3 덮어쓰기 금지, R4 신규 라운드로 연장. `needs_revise` 알람 현행 유지(838건 가시화 완료).
  - Dashboard/Progress Matrix: R4/R5 열 조건부 렌더(has_r4_data 플래그).
- **재개 조건**: 사용자 명시적 승인.

---

## 3. Aconex 임포트 캐시 무효화 (스테일 인스턴스 방지)  `[동결]` `[설계확정]`

- **동결 사유**: `build_id` 강제 스탬프 + 서버 사이드 사후 검증(change_log null_overwrites)으로 임시 완화. 강제 리로드는 UX 부작용 우려로 보류.
- **확정 설계**:
  - 배포 시 `__APP_BUILD_ID__` bump → 클라이언트가 `/api/public/build-check`로 서버 build_id 대조 → 불일치 시 `Import blocked: reload required` 모달 강제.
  - 서버는 build_id null 임포트 요청에 `409 Conflict` 반환.
- **재개 조건**: 스테일 인스턴스 사고 재발 시 즉시 재개.

---

## 4. status_mismatch 대시보드 위젯  `[동결]` `[설계확정]`

- **동결 사유**: 정규화(Step 5) 동결과 연동. 정규화 없이 mismatch 정의 불안정.
- **확정 설계**: `latest_status NOT IN ('A','B','C') AND is_terminated=false` 항목을 KPI 카드 및 attention list에 노출. RPC: `abd_dashboard_attention_lists`에 `status_mismatch` 섹션 추가.
- **재개 조건**: Step 5 이후.

---

## 5. Terminated 카탈로그 UI  `[동결]` `[설계확정]`

- **동결 사유**: `is_terminated=true` 플래그 세팅 완료(410건). 별도 관리 화면 요청 없음.
- **확정 설계**: Raw Data에 `is_terminated` 필터 칩 추가(기본 off). 대시보드 총계에서 Terminated 제외 옵션 토글.
- **재개 조건**: 사용자 요청 시.

---

## 6. abd_change_log null_overwrites 실시간 알림  `[동결]` `[설계확정]`

- **동결 사유**: 임포트 종료 후 배너 표시(구현 완료)로 최소 요건 충족. 실시간 push는 인프라 부담.
- **확정 설계**: `abd_change_log` INSERT 트리거 → `pg_notify('abd_null_overwrite', payload)` → 관리자 세션 Realtime 채널 구독 → 토스트 알림.
- **재개 조건**: 사고 재발 or 사용자 요청.

---

## 부록 — 확정 상수/규칙

- 정규 latest_status 코드: `A / B / C / NYS` (4종 고정)
- 라운드 상한: 현행 R3, 확장 설계는 R5까지 커버
- Terminated 가드: `is_terminated=true` 항목은 Aconex 임포트에서 `latest_status` 갱신 대상 제외
- 배포 검증 지표: `abd_import_logs.build_id` non-null + `abd_change_log` upload_id별 null_overwrites=0
