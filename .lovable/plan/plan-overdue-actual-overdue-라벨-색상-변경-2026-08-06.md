# Plan Overdue / Actual Overdue 라벨·색상 변경

## 무엇을 바꾸나

1. **PASS 뱃지 색**: 하늘색 → 진한 회색
2. **RISK / WARNING 라벨 의미 교환**
   - 지금: 마일스톤 초과 = RISK, 마일스톤 이내이나 버퍼(7일) 구간 침범 = WARNING
   - 변경 후: 마일스톤 초과 = WARNING, 버퍼 구간 침범 = RISK
3. **RISK / WARNING 뱃지 색 교환**: RISK = 주황, WARNING = 빨강 (기존 색을 서로 맞바꿈)

SAFE(초록)와 빈칸(마일스톤 미지정)은 변경 없음.

## 변경 후 판정표

| 조건 | 라벨 | 색 |
|---|---|---|
| 완료(actual_finish 있음 또는 진도 100%) | PASS | 진한 회색 |
| 마일스톤보다 7일 이상 여유 | SAFE | 초록 |
| 마일스톤 이내(버퍼 구간 침범) | RISK | 주황 |
| 마일스톤 초과 | WARNING | 빨강 |
| 마일스톤 미지정 / 비교 날짜 없음 | (빈칸) | 없음 |

## 기술 상세

- **DB 마이그레이션 1건**
  - `public.tm_classify_overdue(target, mstone, buffer_days)`: `target <= mstone` 분기 반환값을 `'WARNING'` → `'RISK'`, `else` 분기를 `'RISK'` → `'WARNING'` 으로 교체.
  - `public.v_task_management_raw_derived`: Main 과업 롤업의 심각도 순위 매핑을 함께 조정. 최악값 채택 규칙이 실제 위험도(마일스톤 초과가 가장 나쁨)를 그대로 유지하도록 `WARNING = 3`, `RISK = 2`, `SAFE = 1`, `PASS = 0` 으로 순위를 바꾸고 역매핑도 동일하게 수정. 즉 Main 행은 지금과 동일한 하위 행을 근거로 삼되 라벨 표기만 새 규칙을 따름.
  - 두 오브젝트 외에 `RISK`/`WARNING` 문자열을 쓰는 DB 함수는 없음(`pg_proc` 조회로 확인).
- **프론트엔드 1개 파일**
  - `src/lib/task-management/columns.ts` (131~137): `OVERDUE_COLORS` 를 `PASS` = 진한 회색(slate/zinc 계열), `RISK` = amber, `WARNING` = rose 로 수정하고 상단 주석 갱신.
  - 이 상수는 `TaskManagementRawDataPage.tsx` 의 `plan_overdue` / `actual_overdue` 뱃지에서만 참조되므로 추가 수정 파일 없음.

## 검증

마이그레이션 후 활성 2,058행 기준 분포를 재조회해, 기존 분포와 라벨만 뒤바뀌고 총합·PASS·SAFE·빈칸 건수는 동일한지 실측 확인.