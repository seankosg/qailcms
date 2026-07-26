# TM 판정 로직 정합성 및 임계값 통합 계획

## 1. 판정 오류 근본 원인 (확인됨)

**증상**: MWS에서 `AR-D-T-03`(Plan 53%, Actual 71%, +18%) 및 `EL-D-05`(Diff +1%) 같이 실적이 계획을 앞서는 행도 "위험"으로 표시.

**원인**: `src/lib/task-management/derived.ts:214-227` `computeJudgment` 및 DB `calc_auto_judgment_value`(20260720112155)의 Start 스테이지 후보 포함 조건이 `!row.actual_start` 하나뿐임. 실적이 이미 71%까지 진행되었어도 `actual_start`가 비어있으면 Start 스테이지가 worstOf 후보에 들어가고, `plan_start`가 오래 전이라 `days > slip_late_days(14)` → `j_start='위험'` → 최종 위험. 이는 WIP(gap=+0.18, 정상)와 Finish(plan_end 미래, 정상) 판정이 무의미해지는 버그.

WIP와 Finish 스테이지는 이미 `actual_progress >= 1` 또는 `actual_finish` 여부로 진행 상태를 인지하는데, Start 스테이지만 "실적 진행 중" 신호를 무시하고 있음.

## 2. 수정 범위

### A. Start 스테이지 판정 재검토 (근본 수정)
**파일**: `src/lib/task-management/derived.ts`, 신규 마이그레이션 `supabase/migrations/…_fix_start_judgment.sql`

- `getStageJudgment(stage="start")`: 이미 시작된 것으로 간주하는 조건에 `Number(actual_progress ?? 0) > 0`을 추가 → `완료`로 반환 (착수 판정이므로 진도가 발생했으면 "착수됨"으로 취급).
- `computeJudgment`의 worstOf 후보 포함 조건도 동일하게 `!row.actual_start && Number(row.actual_progress ?? 0) <= 0`일 때만 `jStart` 포함.
- DB `calc_auto_judgment_value` 동일하게 수정: `if _actual_start is not null or coalesce(_actual_progress,0) > 0 then j_start := '완료'`, worstOf 후보 조건도 동일.
- 마이그레이션 말미에 `SELECT public.recalc_task_auto_judgment(NULL);` 및 `SELECT public.rollup_task_all_mains(d) FROM (SELECT DISTINCT discipline …) s(d);` 실행하여 저장값 일괄 재계산.

### B. 임계값 설정 UI 통합
**폐기**: `CriticalThresholdPopover` 트리거를 다음에서 제거.
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx:1203`
- `src/components/task-management/dashboard/TmKpiCards.tsx:209`

**유지/보강**: `/admin/task-thresholds` (이미 존재)를 유일한 설정 지점으로 삼음. Raw Data / Dashboard 상단 툴바에는 "임계값 설정은 Admin → Task Thresholds 참조" 헬프 텍스트(작은 링크)만 배치. `CriticalThresholdPopover.tsx` 파일 자체는 Admin 페이지에서 재사용하지 않으므로 삭제 가능(사용처 재검색 후 잔여 없으면 제거).

두 곳 모두 Admin의 `task_management_settings.default` 단일 레코드를 참조하도록 이미 `useTaskManagementSettings` 훅으로 통일되어 있으므로 소스는 자동 일치.

### C. MWS/MTWS 캡 제거 및 런타임 판정 (진행 중 작업 마무리)
**파일**: `src/hooks/useMyWorkspaceData.ts` (완료), `src/components/my-work-space/MyWorkSpacePage.tsx`

- `useMyTasks`의 5,000/2,000 하드 캡 제거 (완료).
- `TmMyRow` 스키마에 `actual_start`, `actual_finish`, `slip_days` 추가 (완료).
- `MyWorkSpacePage`의 지연 판정 및 알람 뱃지 렌더링을 `computeJudgment(row, thresholds, asOfDate)`로 교체. `auto_judgment` 문자열 직접 참조 제거. 임계값은 `useTaskManagementSettings()`에서 로드.
- `tmStats` 및 리스트 필터도 `isTaskDelayed(row, thresholds, asOfDate)` 기반으로 재계산.

## 3. 다음 단계에서 처리 (범위 외)
- SM 및 ABD 판정 정합성 점검 → 별도 요청 시 진행.

## 4. 셀프 체크리스트 (완료 판정 전 검증)
- [ ] AR-D-T-03: Actual 71%, Plan 53% → `computeJudgment` 결과 "정상" (WIP gap=+0.18, Finish 미래).
- [ ] EL-D-05: Diff +1% → "정상".
- [ ] 실제로 미착수(actual_progress=0, actual_start null)이고 plan_start가 15일 이상 지난 행은 여전히 "위험" 판정.
- [ ] Raw Data / Dashboard 페이지에서 임계값 팝오버 트리거 삭제됨, Admin 페이지에서만 조정 가능.
- [ ] MWS 관리자 로그인 시 TM Total이 DB 활성행 수와 일치.
- [ ] MWS 알람 컬럼 값이 TM Dashboard/Task Summary와 동일한 판정 결과.

## 5. 기술 세부

**Start 스테이지 수정 후 계약**:
- `actual_start != null` → 완료
- `actual_progress > 0` → 완료 (착수 신호로 간주)
- 그 외: `plan_start` 대비 지연일수 기반 위험/지연/주의/정상

DB 함수와 TS 함수는 동일한 조건식을 유지해야 저장값(=Dashboard의 `judgmentCounts`)과 런타임 재계산(=Task Summary/MWS)이 일치.
