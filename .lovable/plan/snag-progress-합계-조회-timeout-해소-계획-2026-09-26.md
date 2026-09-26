# Snag Progress 합계 조회 timeout 해소 계획

## 목표
`getSnagProgressTotals`가 호출하는 합계 RPC의 처리량을 줄여 statement timeout과 빈 화면을 없애되, 화면의 UI·필터·수치·드릴다운 계약은 그대로 유지합니다.

## 확인된 원인
- 합계 RPC는 Plot 하나당 약 6.4만 건을 읽은 뒤, 화면에서 선택하지 않은 단계까지 항상 6단계 전부 판정·집계합니다.
- Day 화면은 현재 기준 합계와 구간 시작 전 합계를 동시에 호출하므로 같은 고비용 계산이 2회 병렬 실행됩니다.
- 다축 그룹 조건 실측은 단일 호출이 약 2.0~3.3초였고 임시 정렬 데이터도 발생했습니다. 동시 요청과 운영 부하가 겹치면 statement timeout 경계를 넘을 수 있습니다.

## 변경 내용
1. `defect_snag_progress_totals`와 JSON 래퍼에 선택 단계 파라미터를 추가합니다.
   - 기존 시그니처를 같은 마이그레이션에서 먼저 `DROP FUNCTION` 합니다.
   - 새 파라미터에는 기본값을 두고, 오버로드는 각 함수 1개만 남깁니다.
   - 화면이 요청한 단계만 `_snag_done_asof`, 계획·실적·No Plan 집계를 수행합니다.
   - 기존 정본 판정 함수와 Remaining/Baseline 계산식은 변경하지 않습니다.
2. `getSnagProgressTotals`가 선택 단계를 검증해 RPC에 전달하도록 수정합니다.
3. Progress 화면과 공용 S-Curve 훅의 `queryKey`와 호출값에 선택 단계를 포함합니다.
   - Progress 화면의 현재 합계와 Day 누계 모두 동일한 선택 단계를 사용합니다.
   - KPI/Project Dashboard는 현재 선택한 단일 단계만 요청합니다.
4. 기술 결정은 `AGENTS.md`에 기록합니다.

## 검증
- 변경 전·후 결과를 동일 필터/기준일로 비교해 반환 행과 모든 합계 필드 불일치가 0건인지 확인합니다.
- 최악 그룹 조건과 실제 기본 화면 조건의 실행시간을 재측정합니다.
- RPC 오버로드가 함수별 1건인지 확인합니다.
- 로그인 상태에서 Snag Progress Day/Week 화면과 Project Dashboard를 열어 timeout·빈 화면이 없고 숫자와 드릴다운이 유지되는지 확인합니다.
- 최신 빌드 오류 기록을 확인합니다.

## 영향 파일
- 새 database migration 1개
- `src/lib/defect-management/progress.functions.ts`
- `src/components/defect-management/progress/SnagProgressPage.tsx`
- `src/hooks/useSnagScurveData.ts`
- `AGENTS.md`
