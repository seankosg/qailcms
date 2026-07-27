## 목표
TM Raw Data에 Milestone 컬럼과 2단계 일정 경보(Plan Overdue / Actual Overdue) 및 Expected Finish Date 파생 컬럼을 도입한다. 판정 로직은 DB 단일 소스, UI는 코드→라벨 매핑만 담당한다.

## 확인 사항
- 업로드 파일 실측 결과: 1,440행, Task No 유니크, Milestone 분포 = **H/O 824 / COC 445 / DLP 171** (지시서와 일치).
- 파일값 `H/O`는 스펙 허용값 `HO`로 정규화하여 시드(CHECK 제약: `HO/COC/DLP`).

## [1] 스키마 · 시드
- 마이그레이션 1: `task_management_raw.milestone text` 추가 + `CHECK (milestone IS NULL OR milestone IN ('HO','COC','DLP'))`. 인덱스 `(plot, milestone)`.
- 마이그레이션 2: 1,440건 하드코딩 시드 (Task No 매칭, H/O→HO 변환, `is_active=true`인 최신 행만 대상). Main 상속 없음 — 행 단위 UPDATE.
- 검증 쿼리로 분포(HO 824/COC 445/DLP 171)와 실측 시각(UTC) 보고.

## [2] Admin Milestone 설정 페이지
- 신규 테이블 `tm_milestone_config(plot text, kind text, target_date date, updated_by uuid, updated_at timestamptz, PK(plot,kind))` + 감사 테이블 `tm_milestone_config_audit(plot, kind, old_date, new_date, changed_by, changed_at)` — UPDATE 트리거로 이력 자동 기록.
- 파라미터 테이블 `tm_alarm_settings(key text PK, value_int int, ...)` — `warning_buffer_days` 기본 7 (설정 가능).
- 페이지: `src/routes/_authenticated/tm/admin/milestones.tsx`. ALSMK 참조 프로젝트(`7c8c38db-...`)의 admin milestone 탭 레이아웃 그대로 이식(6개 셀 = Plot C/D × HO/COC/DLP + Buffer Days 입력 + 이력 리스트).
- 미설정 셀은 상단에 경고 배너 노출, 경보 컬럼은 무표시.

## [3] 파생 로직 (단일 소스: DB 함수)
`public.tm_compute_alarms(row task_management_raw)` 불변(IMMUTABLE 대신 STABLE) SQL 함수 하나로 3필드 산출.

**Plan Overdue** (P.Finish vs milestone, buffer=B):
- `p_finish ≤ mstone − B` → SAFE
- `mstone − B < p_finish ≤ mstone` → WARNING (경계: `mstone−B+1 … mstone`)
- `p_finish > mstone` → RISK
- P.Finish NULL 또는 milestone/mstone NULL → NULL

**Expected Finish Date**:
- `actual_finish IS NOT NULL OR actual% = 100` → `actual_finish` (또는 data_date)
- `actual_start IS NULL OR actual% = 0` → NULL
- `elapsed = data_date − actual_start + 1`, `daily = actual% / elapsed`, `remain = ceil((100 − actual%) / daily)`, `expected = data_date + remain`. 0-division 가드.

**Actual Overdue**: Expected Finish vs milestone에 동일 3단계 판정.

산출 경로:
- 뷰 `v_task_management_raw_derived`가 raw + alarm 3필드 JOIN 후 조회. Raw Data 화면·Export·대시보드는 이 뷰만 참조 (재계산 금지).
- 1,440행 이상 반환 경로는 jsonb 단일 반환 또는 range 페치 표준.
- 마일스톤/버퍼 변경 시 즉시 반영 (뷰이므로 자동), 임포트 시에도 자동 재계산.

## [4] 임포트 · 헤더 컨피그
- `task_management_field_config` / `task_management_header_mappings`에 `milestone` 추가 (Import 가능, 별칭: "Milestone", "H/O 값 자동 정규화").
- `Plan Overdue`, `Expected Finish Date`, `Actual Overdue` 3필드는 파생 배지 표시. 임포트 파서에서 해당 컬럼 감지 시 무시 + `import_field_logs`에 "derived field ignored" 기록.

## [5] UI 표시
- Raw Data 그리드에 3컬럼 신설 (Milestone / Plan Overdue / Expected Finish / Actual Overdue).
- 코드→라벨 매핑 유틸 `src/lib/tm/alarmLabels.ts`: SAFE=안전(초록), WARNING=주의(황), RISK=위험(빨강). Detail 창·Export·필터 칩 모두 동일 유틸 사용.
- 필터: Plan Overdue / Actual Overdue 다중선택 칩 (SAFE/WARNING/RISK/무표시).

## [6] 완료 증빙 (보고 항목)
1. 시드 분포 실측 (HO 824/COC 445/DLP 171) + UTC 시각
2. SAFE/WARNING/RISK 각 2건 실제 행 스크린샷
3. Expected Finish 수기 대조 3건 (미착수/중간/완료 근접)
4. 엣지 케이스 각 1건 (미착수, Actual%=100, Actual%=0)
5. 마일스톤 미설정 Plot×Kind 조합에서 무표시 동작 확인

## 기술 세부
- 마이그레이션·타입 재생성·호출부 수정 원자 커밋.
- 신규 RPC 없이 view 기반이 기본, 필요 시 `tm_derived_by_ids(uuid[])` 헬퍼만 추가.
- 파라미터 `warning_buffer_days`는 `tm_alarm_settings`에서 함수가 SELECT (STABLE 유지).
