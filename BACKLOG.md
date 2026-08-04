# ABD 정합성 BACKLOG (동결 항목)

본 문서는 2026-07-27 기준 사용자 지시에 따라 **동결(freeze) 결정**된 항목과 각 항목의 **확정 설계**를 기록한다. 향후 별도 승인 없이 진행 금지.

상태 표기: `[동결]` = 실행 보류, `[설계확정]` = 접근·스키마·쿼리까지 확정.

---

## 0. hdec_pic_master / hdec_eng_master 뷰 SECURITY DEFINER 해소  `[동결]` `[설계확정]`

- **동결 사유**: 두 뷰는 `profiles`(RLS: `id = auth.uid() OR is_admin_or_super`)를 UNION하는 구조. `security_invoker=on`으로 전환 시 비관리자 authenticated 사용자에게 profiles 파트가 자기 1행만 노출되어 임포트 매핑 다이얼로그·MWS PIC/ENG 선택 옵션이 대량 소실(회귀). 실측: profiles 31행 중 자기 1행만 조회 가능해짐.
- **확정 설계**:
  - profiles를 우회하는 SECURITY DEFINER 함수 `list_hdec_pic_names()` / `list_hdec_eng_names()` 신설 (search_path 고정, authenticated에만 EXECUTE 허용, 활성 profiles + name_master UNION 결과 반환).
  - `useMasterOptions.ts`, `AbdImportPage.tsx` 등 뷰 소비처를 RPC 호출로 전환.
  - 두 뷰 DROP.
  - 카운트 실측: 전환 전후 각 사용자 유형별 조회 행수 동일함 확인 후 배포.
- **재개 조건**: 사용자 명시적 승인.

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

## 10. TM today_actual / today_gap 서버 정렬 통합 (LATERAL)  `[동결]` `[설계확정]`

- **동결 사유**: 2026-07-27 사용자 결정 "페이지 스코프 정렬로 충분, 필요해지면 그때 (a)로". C1 페이지 교체 라운드에서도 페이지 내 정렬을 유지한다.
- **문제**: `today_actual`(as-of 기준 실적%)과 `today_gap`(T.Plan 대비 갭)은 시점(as_of) 파라미터에 의존하는 파생값이라 `v_task_management_raw_derived` 뷰의 정적 컬럼으로 통합 불가. 현재 서버 정렬 화이트리스트에는 미등재.
- **확정 설계** (재개 시 그대로 시행):
  - `tm_items_search` RPC 시그니처에 `_as_of date default null` 파라미터 추가. null 시 서버가 `current_date at time zone 'Asia/Qatar'` 로 대체.
  - 검색 CTE 에 LATERAL 서브쿼리로 `today_actual`, `today_gap` 을 as_of 시점 기준 계산해 붙임. 기존 뷰는 손대지 않고 RPC 내부에서만 파생.
  - 정렬 화이트리스트에 두 컬럼 추가. facets/필터 화이트리스트에는 추가하지 않음(값 무한).
  - `useTmServerItems` 어댑터에 `asOf` 옵션 추가 및 페이지 컴포넌트에서 shared data date 와 연동.
- **재개 조건**: 페이지 스코프 정렬이 부족한 사용자 시나리오 발견 시(예: 데이터셋 규모가 페이지 크기를 크게 초과하고 오늘 실적 기준 상위 N 조회가 반복 요청됨).

---

## 11. SM/ABD 판정 로직 단일화 (SQL 진실원 이식)  `[등재]` `[설계미확정]`

- **등재 사유**: 2026-07-28 사용자 승인. TM 라운드(카드↔드릴다운 불일치 수정)와 동일 원인 구조를 SM/ABD도 보유. 이번 턴 착수 금지, 별도 승인 시 재개.
- **원인 구조**:
  - ABD (**차기 1순위, TM 검증 통과 직후 착수 검토**): (a) 임포트 시 `abd_compute_derived` 트리거가 판정 저장 → (b) Dashboard/Progress SQL RPC(`abd_dashboard_*_json`)가 저장값·재계산 혼합 → (c) Raw Data는 저장값 + Latest Status 클라 오버라이드(`AbdRawDataPage.tsx:233,343,935,1006`). Dashboard→Raw Data 딥링크 존재 확정(`AbdDashboardPage.tsx:102-114 openRawData()`, 2026-07-28 실측) → TM과 동일 구조의 카드↔드릴다운 불일치 노출 위험을 이미 보유. 착수는 여전히 별도 승인 필요.
  - SM (**후순위**): (a) Raw Data 표시=클라 재계산(`stage-utils.ts:isStageDelayedAsOf/classifyDefectStage`) (b) Dashboard/Progress=SQL RPC(`defect_snag_*_json`). 판정 사본 이원화되어 있으나 카드→Raw Data 딥링크 부재. 잠재 위험만.
- **원칙**: TM 라운드에서 확립될 "판정 정본은 SQL 한 벌, 클라이언트는 서버 결과를 소비만" 규약을 SM/ABD로 확장. ABD는 저장값과 재계산 혼재를 어느 방향으로 통일할지(재계산 우위 vs 저장값 우위) 착수 전 결정 필요.
- **재개 조건**: TM 라운드 완료(kpi-utils.ts 술어 제거 및 서버 counts 전환) 후 사용자 명시적 승인.

---

## 부록 — 확정 상수/규칙

- 정규 latest_status 코드: `A / B / C / NYS` (4종 고정)
- 라운드 상한: 현행 R3, 확장 설계는 R5까지 커버
- Terminated 가드: `is_terminated=true` 항목은 Aconex 임포트에서 `latest_status` 갱신 대상 제외
- 배포 검증 지표: `abd_import_logs.build_id` non-null + `abd_change_log` upload_id별 null_overwrites=0

---

## 부록 — RPC 반환 계약 감사 (2026-07-28 갱신)

### 시행 완료 (동결 해제)

- **A15 · `defect_snag_progress_cells` → `_json` 전환**: `RETURNS jsonb` 스칼라 반환으로 재작성. 180d/day/team 호출 실측 1,171셀 전량 수신 확인 (PostgREST 1,000행 상한 회피). 원인은 SM Progress 매트릭스에서 Range 확장 시 계획값 유실(예: ELEC·7/29·Rect 64→0)로 실사용 발현.
- **A16 · `defect_snag_progress_totals` / `defect_snag_dashboard_matrix` → `_json` 전환**: 동일 상한 위험(그룹 카디널리티 × stage). 세 함수 모두 `_json` 래퍼 신설 + 클라이언트 언랩(`src/lib/defect-management/progress.functions.ts`, `src/hooks/useSnagDashboardMatrix.ts`) + 배열 shape 검증 완료.
- **증빙(2026-07-28 UTC 07:43)**: 60d/180d 겹치는 전 구간 전수 diff = 0 mismatch. Data API 경유 scalar jsonb 응답 shape 확인.

### 상한 잘림의 세 번째 실사용 발현

선례: (1) TM `tm_items_search`(C1 라운드), (2) ABD `abd_progress_cells`(정규화 라운드), (3) SM `defect_snag_progress_cells`(본 건). AGENTS.md 규칙 2("행수 상한 비보장 조회 = jsonb 단일 반환")를 위반하는 신규 RPC 작성 금지.

### 잔여 `RETURNS TABLE` RPC 실측 (2026-07-28)

| RPC | 무필터 행수 | 위험 |
| --- | --- | --- |
| `abd_dashboard_crosscut` | 123 | LOW |
| `tm_items_facets` (17축 일괄) | 73 | LOW |
| `abd_dashboard_approval_trend` (12mo) | 21 | LOW |
| `abd_dashboard_row1` | 13 | LOW |
| `abd_dashboard_row2` | 6 | LOW |
| `abd_dashboard_status_dist` | 4 | LOW |
| `abd_dashboard_judgment_mix` | 4 | LOW |
| `abd_dashboard_overdue_heatmap` | 3 | LOW |
| `abd_items_facets` / `defect_items_facets` / `dmr_facets` | `_limit` 파라미터 상한 | LOW |
| `abd_items_search` / `defect_items_search` / `tm_judge_snapshot_at_date` | rows 필드가 jsonb 페이로드 | LOW |
| `sm_my_workspace_rows` / `sm_my_workspace_counts` | 사용자별 스코프 소규모 | LOW |

전 항목 500행 미만 또는 파라미터로 상한 강제. 추가 전환 불필요. 데이터 성장에 따라 재점검 대상은 `abd_dashboard_crosscut`(현 123, 축 확장 시 위험).

### 성장 감시 대상

- `abd_dashboard_crosscut` — 현행 무필터 123행. 축 확장/데이터 성장 시 1,000행 상한 근접 여부 정기 실측 필요. 근접 발견 시 `_json` 스칼라 반환으로 즉시 전환.

### R3 · pageSize=ALL 병렬 페치 (2026-07-28 시행 완료)

- 대상: `useAbdItemsQuery`(`abd_items_search`), `useDefectItemsQuery`(`defect_items_search`).
- 변경: ALL 모드에서 첫 청크로 total 확보 후, 나머지 청크 오프셋을 `Promise.all` 로 병렬 페치. 순차 루프 → 병렬 페치로 대기시간 단축.
- UI 불변: 반환 형태·순서(offset asc) 동일, 잘림 감시(`assertNoTruncation`) 유지.
- 실측(Data API 경유, `_excluded_mode='all'`/`_include_inactive=true`, 3회 평균):
  - ABD MECH (2,598행, 3청크): before(seq) 778ms → after(par) 579ms · 1.34×
  - ABD ELEC (4,090행, 5청크): before(seq) 1,153ms → after(par) 823ms · 1.40×
  - SM ALL (116,234행, 117청크): before(seq) 45,467ms → after(par) 20,189ms · 2.25×
  - 반환 행수 before=after 완전 일치(3회 전 구간).

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

---

## RPC 사일런트 필터 드롭 — SM/TM 확장 적용 (백로그)

2026-07-29 ABD(`abd_items_search`, `abd_items_facets`)에 런타임 유도 화이트리스트 + `RAISE EXCEPTION` 패턴을 적용해 정합 문제(494/20 등)를 해결했다. 동일 패턴이 다음 함수에도 존재하며, ABD에서 안정성이 검증되면 후속 티켓에서 같은 방식으로 이관한다.

대상 함수(감사 결과, 사일런트 `CONTINUE` 확인):
- `defect_items_search` (SM)
- `defect_items_search_ids` (SM)
- `tm_items_search` (TM)
- `tm_items_search_ids` (TM)

참고:
- `tm_items_facets`, `abd_items_counts`, `abd_items_by_numbers` 는 `_allowed_cols` 미사용 → 이번 대상 아님.
- 이관 시 각 모듈별 `*_derived_cols()` 헬퍼를 신설하고 AGENTS.md의 "RPC 필터/정렬 허용 컬럼 규칙"에 준한다.
- 이관 전 각 모듈의 클라이언트 필터/정렬 컬럼을 전수 실측 대조하여, 전환 직후 정상 요청이 EXCEPTION으로 깨지지 않도록 검증한다.

---

## TM Dashboard 위젯: derived_auto_judgment(_as_of) 소비 전환  `[승인]`

2026-07-29 지연 Top 20 개편 및 리더보드 지연 축 통일을 시행하면서, 위젯 계산은 클라이언트 미러(`computeJudgment` / `cumPlanProgress` / `cumActualProgress` / `computeVariance`)에 의존하고 있다. stored `auto_judgment` 우선 + 클라 미러 폴백은 **과도기 조치**로만 수용한다.

- 목표: 대시보드 위젯 행이 `tm_items_search(_as_of=selectedDataDate)` 응답의 서버 파생 필드(`derived_auto_judgment`, `derived_gap_pct`, `derived_delay_days`, `derived_cum_plan_pct` 등)만 소비하도록 전환하고, 클라이언트 미러 코드(`derived.ts` 판정/누계 함수)를 위젯 경로에서 제거.
- 범위: `DelayTopTable`, `OwnerLeaderboardCard`, `TmKpiCards`, `JudgmentStageBreakdown` 등 TM 대시보드 위젯 및 MWS 카운트.
- 선행: `tm_items_search` 에 `_as_of` 파라미터를 정식 지원하고 응답 스키마에 파생 필드 4종을 확정. 과거 Data Date 재판정을 서버 단일 소스로 통일.
- 재개 조건: 별도 승인 없이 후속 라운드에서 진행 가능.

---

## ABD Progress 스트립 — Draft Finish Delay 카드 추가  `[보류]`

2026-07-29 지시로 **추가하지 않음**을 확정. Progress 페이지 KPI 스트립은 현행 3카드(Response / Submission / Draft Delay) 배치를 유지한다.
대시보드(`AbdKpiRows.tsx`)에만 `DF_DELAY` 카드가 존재하므로 두 화면의 카드 구성이 의도적으로 다르다.
재개 조건: 별도 지시로 Progress 스트립 UI 변경이 승인될 때.

## ABD 계획 순서 이상(선행 계획 미래 ∧ 후속 계획 과거) — HDEC 파일 수정 후보  `[보고 완료]`

2026-07-29 실측 4건. 데이터 수정 금지, 원본 파일 정정 사안.
- `9207-BP12D-HDEC-ABD-ME-NS-B04-41101` ~ `41104` (current_stage `DF2`)
  - `r2_draft_finish_plan` 2026-07-30(미래)인데 후속 `r2_submission_plan` 2026-07-27(과거) → 선후 역전.

## ABD 완료 기준 KPI 카드 (completed_stage_group)  `[등재만 · 착수 금지]`

2026-07-29 Completed Stage 파생 신설과 함께 등재. `completed_stage_group`(NS/DS/DF/SB/RS/TM/APPROVED)을
기존 stage_group 7카드 패턴으로 재사용하는 "완료 기준" KPI 스트립. 이번 라운드는 컬럼·표기까지만 시행하고
카드 UI 는 착수하지 않는다. 재개 조건: 별도 지시.

## ABD 내부 키 개명 (UR 어휘 잔재)  `[등재만 · 착수 금지]`

화면 라벨은 2026-07-29 라운드에서 "Awaiting Response" 등으로 정정 완료. 다음 내부 키는 딥링크·RPC
하위호환 때문에 유지한다.
- `bucket_top = 'UR'` (의미 = 회신 대기 RS)
- `abd_items_raw.ur_aging_days` (의미 = 회신 대기 경과일)
- `abd_settings.ur_aging_warn_days` / `ur_aging_late_days`
- status_group 딥링크 키 `under_review`
- `rs_result_missing` (의미 = 회신 도착했으나 결과 코드 A/B/C 누락 — RS 의미로 이미 정합)
재개 조건: 딥링크 어댑터(구 키 → 신 키 리다이렉트) 설계 승인 후.

## SM 임포트 — 원본에서 삭제·정정된 실적일의 영구 잔존  `[등재만 · 착수 금지]`

2026-08-01 실측(506건 조사) 확인. `DefectManagementImportContext.tsx` 의 `put()` 은 파일 값이
`null`/`undefined` 이면 payload 에서 제외해 DB 기존값을 보존한다(빈값 보호). 따라서 HDEC 원본에서
실적일이 삭제·정정되어도 CMS 값은 갱신되지 않고 영구 잔존한다. 현재 정정 경로는 **인앱 편집뿐**이다.
검토 대상(착수 금지): "원본 파일에 없는 값 표시" 진단 뷰(최신 임포트 파일 대비 DB 잔존 실적일 목록).
재개 조건: 별도 지시.

## SM 임포트 — 정본 시트 미지정(시트 선택 가변성)  `[등재만 · 착수 금지]`

임포터에 고정 시트명이 없어 사용자가 시트를 선택한다(2026-07-28 하루에만 5종 시트 혼재 확인).
시트에 따라 모집단(행수·컬럼 구성)이 달라져 임포트 결과 범위가 달라진다.
검토 대상(착수 금지): (a) 모듈별 정본 시트 지정, (b) 정본 외 시트 선택 시 스코프 경고 배너.
재개 조건: 별도 지시.

## TM 모집단 변동 추적 (삭제·추가 경로)  `[등재만 · 착수 금지]`

`task_management_raw` 총계가 라운드마다 변동한다. 변동 이력:
- 2026-08-01 이전: 1,467건
- 2026-08-01 실측: **1,471건 (+4)** — 총계 1,471 / `is_active = true` 1,471 / `is_active = false` 0
- 2026-08-01 동일자 재실측: **1,483건 (+12)** — 총계 1,483 / `is_active = true` 1,483 / `is_active = false` 0
  (즉 소프트 삭제 흔적 없음 → 임포트 신규 추가로 추정. 배치 단위 추적 근거 부족)

검토 대상(착수 금지): (a) 임포트 배치별 신규/갱신/삭제 건수 스냅샷 로깅, (b) 총계 변동 알림(직전 임포트 대비 ±N),
(c) 하드 삭제 경로 존재 여부 감사(`is_active` 소프트 삭제 일원화).
재개 조건: 별도 지시.

## TM 임포트 — 계획축 / 실적축 분리  `[등재만 · 착수 금지]`

근거(2026-08-02 실측):
- 'all' 스코프 사용 9명은 **전원 superuser**였고, UI 결함(`isAdmin = admin || superuser`)으로
  드롭다운이 숨겨져 'all' 이 **강제**되었다. → 5-1(TM 전용 `tmIsAdmin = admin` 단독)으로 해소.
- 본인담당/파일행 비율: 유태완·이남길·박명천·KD Park 100%, 신민호 97~98%, 이준용 68%,
  **김홍엽 1.1%(4/366)**. 9명 중 6명은 'mine' 으로 불편이 없다.
- 소유권 판정 교체(A→B/C)는 효과 없음(A≠C = 0). **(B) 로 확정, 1-3 정본 경유 리팩터는 미시행.**
- 잔존 위험: 마스터 파일 관리자 유형(김홍엽 님)은 5-1 후에도 'all' 을 선택할 수밖에 없고,
  이 경우 ARCH 366행의 타인 실적이 계속 덮인다.
- 오늘(08-02) 임포트로 `hdec_pic_name` 이 **42행** 변경됨(신규 배정 26 + 담당 이동 16).
  박기덕↔박명천 3/3, 박기덕↔백주호 3/3, 박명천↔백주호 1/1 의 **핑퐁**이 실재한다.

검토 대상(착수 금지): 계획축(일정·구조·담당)과 실적축(진도율·실적일)을 분리하여,
'all' 스코프는 계획축만 갱신하고 실적축은 본인 담당 행에만 적용.
**"본인 담당" 판정 시점은 반드시 임포트 *전(前)* 의 `owner_user_id` 기준**이어야 한다
(파일이 PIC 를 바꾸면서 동시에 그 파일 기준으로 실적 권한을 얻으면 보호가 무의미해진다).

재개 조건: 5-1 시행 후 1주간 `task_management_import_logs.note` 의 scope 분포 집계
(§1-4)에서 'all' 잔존 규모를 확인한 뒤 지시자 판단.

---

## HDEC 마스터 엑셀 원본 수정 요청 — "실제 완료" 열 신설  `[최우선 · 대외 요청]`

등재일: 2026-08-03 (R1-7 집행 후)

- **문제**: 현행 ARCH(건축) 마스터 양식은 **실제 완료일 전용 열이 없다**. 실적 완료일을
  `예상 완료(Revised Finish)` 열에 함께 적도록 r4 주석행이 유도하고 있어, 계획값과 실적값이
  한 열에 섞여 유입된다.
- **실측 근거**: 완료(`actual_finish` NOT NULL) 323건 중 **277건(85.8%)** 이
  `actual_finish = forecast_end` 로 일치한다 — 즉 예상 완료 열에서 들어온 값이다.
  공종 분해: ARCH 112 / ELEC 94 / MECH 71. 이 중 데이터 컷오프일 자동충전 흔적은 5건뿐이고
  **272건은 사람이 직접 적은 날짜**로, 실제 완료일일 가능성이 높다.
- **요청 사항**: 마스터 엑셀에 **`실제 완료(Actual Finish)` 열을 신설**하고
  `예상 완료(Revised Finish)` 와 분리한다. r4 주석의 "완료 시 예상 완료 열에 실제 완료일 기입"
  안내를 삭제한다.
- **앱 측 대응(시행 완료)**: 예상 완료 열에서 유입된 값은 `actual_finish_source='forecast'` 로
  표시하고 상세 화면에 배지 노출 — 문구: **"완료일 미확인 — '예상 완료' 열에서 들어온 값입니다.
  확인해 주세요."** ("잘못된 값" 이 아니다. 확인 1회로 해제.)
- **재개 조건**: HDEC 원본 양식 개정본 수령 시 파서 열 매핑 갱신.

---

## 계획-실적 역전 19건 — 원본 확인 필요  `[조사 대기]`

등재일: 2026-08-03 (R1-9 집행 시)

- **현상**: `actual_finish < plan_start` 인 행이 **19건**(전부 level='sub').
  공종 분해: ELEC 12 / MECH 5 / ARCH 2.
- **성격**: 날짜 범위 CHECK(2020~2035) 통과 → 1902 류 오손 아님. 계획이 사후 수립됐거나
  계획 시작일이 잘못 유입된 경우로 추정.
- **처리**: R1-9 대상 아님. 원본(HDEC 마스터 엑셀) 대조 후 판단.
- **목록**: AR-D-P-02-05, AR-D-P-02-06, EL-C-06-02, EL-C-16-01, EL-C-22-07,
  EL-C-23-01, EL-D-02-01, EL-D-03-02, EL-D-09-02, EL-D-14-01, EL-D-19-03,
  EL-D-22-02, EL-D-24-06, EL-D-31-02, ME-C-07-01, ME-C-10-09, ME-C-10-10,
  ME-G-02-03, ME-G-02-12

---

## status_history 인덱스 2종 병존  `[보류 — 보존 기간 정책과 함께]`

등재일: 2026-08-03 (R2 최종 검산)

- `idx_tmsh_taskraw_field_changed_old`(전체) 와 `idx_tmsh_taskraw_field_changed`(부분,
  `WHERE new_value IS NOT NULL`) 2종 병존. 파생 4종 이력 제외로 증가율이 낮아졌으므로
  보존 기간 정책 결정 시 함께 재검토.

---

## status_history 과거 파생 4종 69,013행 정리  `[보류]`

등재일: 2026-08-03 (R2-7)

- 과거 파생 4종 이력 **69,013행(전체의 62%)**. 삭제하지 않고 보존 기간 정책과 함께 결정.
- 현재 규모: **111,200행 / 27MB**.

---

## TM 파서 위치 폴백 잔존 필드 19종  `[등재 — 2026-08-03]`

`src/lib/task-management/parser.ts:527~547` 의 `pick(target, aliases, canonical)` 3번째 인자는
헤더 별칭 매칭 실패 시 **엑셀 열 위치로 강제 지정**하는 폴백이다.
사람 이름 2종(`hdec_pic_name`, `hdec_eng_name`)은 2026-08-03 제거(→0)했고, 아래 19종은 잔존:

| 필드 | 폴백 열 | 필드 | 폴백 열 |
|---|---|---|---|
| task_no | 1 | actual_start | 14 |
| category | 2 | actual_progress | 15 |
| plot | 3 | plan_progress | 16 |
| task_name | 4 | progress_variance | 17 |
| risk | 5 | forecast_end | 18 |
| sub_task_desc | 6 | slip_days | 19 |
| row_type | 9 | auto_judgment | 20 |
| status_manual | 10 | | |
| plan_start | 11 | | |
| plan_end | 12 | | |
| plan_days | 13 | | |

- 위험도: 사람 이름/소유권 판정에는 무관(사람 축 2종은 이미 제거됨).
- 잔여 위험: 열 순서가 다른 파일 임포트 시 값이 엉뚱한 컬럼으로 들어갈 수 있음.
- 조치안: 별칭 매칭 실패 시 폴백 대신 컬럼 매핑 다이얼로그 강제 노출.

## RCL 보류 항목 (2026-08-04 지시자 확정)
- [보류] SPL 행 편집 가드 신설 — 착수 시점: SPL 데이터 마이그레이션 완료 후. 그때 행 가드 + RLS 를 한 번에.
- [보류] WRT 행 편집 가드 신설 — 착수 시점: WRT 데이터 마이그레이션 완료 후. 그때 행 가드 + RLS 를 한 번에.
- [보류] SPL·WRT RLS 범위 술어 — 현행 유지(admin·superuser·d_superuser). 행 가드 없이 먼저 열지 않는다.
- [보류] SPL·WRT 는 RCL 검증 모집단에서 제외(§C-4).
- [보류] rcl_scope_of_values 가 rcl_scope 로직을 SQL 복제 중(2벌) — 위임 구조로 통합 검토(지시 없어 미시행).

- [ ] #0804 isAdmin(admin ∪ superuser) → isAdminOrSuperuser 로 명칭 변경. isStrictAdmin(admin 단독)과 혼동 방지. 배포 이후 착수. (2026-08-04 지시 §3)

- [ ] #0804 guest·super_guest 권한 범위 재정의 (현재 other_team read=Y, user 보다 넓음. 계정 0명. 배포 후 지시자가 정함)
