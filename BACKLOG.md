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

## 7. needs_planning 조건 확대  `[동결]` `[설계확정]`

- **동결 사유**: 현행 트리거는 R1 착수 전(모든 라운드 계획 부재) 케이스만 `needs_planning=true`. R2/R3 라운드 진입 후 부분 계획만 존재하는 케이스(DS만 있고 DF/SB 없음, 또는 SB만 있고 DS/DF 없음)는 어텐션에서 누락.
- **확정 설계**:
  - 판정 확장: 활성 라운드(current_stage 소속)의 DS/DF/SB **3종 계획 완전성** 검사. 하나라도 결측이면 `needs_planning=true`.
  - 트리거 위치: `abd_compute_derived` 내 기존 `needs_planning` 블록에 활성 라운드 3종 결측 검사 추가. Approval(latest_status='A') 및 `is_terminated=true`는 제외.
  - Attention Inbox 라벨: 기존 "계획필요" 탭에 병합 (하위 사유 태그 `partial_plan` 부여).
  - 예상 영향 규모: 사전 조사 필요(rough estimate: 활성 R2/R3 항목 중 ~400-600건).
- **재개 조건**: 사용자 명시적 승인.

---

## 8. terminated_replan 어텐션  `[동결]` `[설계확정]`

- **동결 사유**: Terminated 항목이 후속 재발주(re-plan)로 다시 활성화되는 케이스에 대한 감지 로직 부재. 현재는 `is_terminated=true` 세팅 이후 상태 전이 감시 없음.
- **확정 설계**:
  - 조건: `is_terminated=true` && (`latest_status` IN ('A','B','C') OR 신규 라운드 계획일자 신규 입력됨) → `terminated_replan=true` 플래그 세팅.
  - 트리거: `abd_items_raw` AFTER UPDATE에서 `is_terminated` unchanged=true인데 상태/계획 변경 감지 시 `terminated_replan` 세팅. 임포트/수동 편집 모두 커버.
  - Attention Inbox 신규 탭: "Terminated 재계획" (아이콘 RefreshCcw, tone info). 관리자가 검토 후 `is_terminated=false`로 되돌리는 액션 버튼.
  - RPC 확장: `abd_dashboard_attention_lists`에 `terminated_replan` 섹션 추가.
- **재개 조건**: 첫 재발주 사례 발견 시 즉시 재개.

---

## 9. 비활성 3건 수동 검토  `[동결]` `[설계확정]`

- **동결 사유**: `is_active=false`이면서 `is_terminated=false`인 3건은 어느 파이프라인 룰에도 부합하지 않는 예외 케이스. 자동 판정 불가.
- **확정 설계**:
  - 대상 특정 쿼리: `SELECT id, abd_number, document_title, latest_status, updated_at FROM abd_items_raw WHERE is_active=false AND is_terminated=false;` (현재 3건)
  - 검토 산출물: 각 건별 (a) 원본 파일에서의 상태, (b) 비활성화된 계기(Import log 추적), (c) 조치안: 재활성화 / Terminated 전환 / 유지.
  - 조치 방식: 관리자 UI에서 수동 편집 (Bulk 편집 대상 아님).
  - 재발 방지: 임포트 파이프라인에서 `is_active=false && is_terminated=false` 상태로 진입하는 경로가 있는지 감사 로그 확인.
- **재개 조건**: 사용자가 수동 검토 착수 지시.

---

## 부록 — 확정 상수/규칙

- 정규 latest_status 코드: `A / B / C / NYS` (4종 고정)
- 라운드 상한: 현행 R3, 확장 설계는 R5까지 커버
- Terminated 가드: `is_terminated=true` 항목은 Aconex 임포트에서 `latest_status` 갱신 대상 제외
- 배포 검증 지표: `abd_import_logs.build_id` non-null + `abd_change_log` upload_id별 null_overwrites=0

---

## 운영 원칙 — 설계 변경 사전 보고 (필수)

승인된 설계·범위의 어떠한 변경도 **시행 전 사용자 확인**을 거친다. 사후 승인이 필요한 상태로 시행하는 것은 원칙 위반이며, 발견 시 롤백 또는 사후 승인 절차를 반드시 남긴다.

대상(예시, 한정 아님):
- 데이터 모델(테이블/컬럼/enum/제약)의 추가·삭제·의미 변경
- 승인된 UI 카드·슬롯 수의 증감(예: Plot 6→9)
- 판정식·집계식·라운드/스테이지 수식 변경
- 임포트/파서 규칙 확장(방어 로직 포함)
- 스크립트/마이그레이션의 실행 순서·트랜잭션 경계 변경

절차:
1. 사전 보고(사유·범위·영향·롤백 방안) → 2. 승인 대기 → 3. 시행 → 4. 실측 결과 보고.

상세 규정은 `AGENTS.md`의 "설계 변경 사전 보고 원칙" 참조.

### 위반 기록(투명성)

- 2026-07-27: '공통' Plot 슬롯 신설(6→9) — 사전 보고 없이 시행, 사후 승인 접수. 이후 유사 사례 재발 시 즉시 롤백 원칙 적용.
- 2026-07-27: Q2 절차 이탈 — 참조 프로젝트 소스 실측 없이 자체 정의 대조로 "매칭 ✓" 판정. 이후 사후 대조 검토로 대체 수행 예정.
