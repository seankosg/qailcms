## 목표
Progress Matrix의 실적(Actual) 집계를 KPI 카드/Total과 동일한 확장 Done 로직으로 통일하되, 일자 미지정 Done은 'Up to 21-Jul' 누계 컬럼에만 반영.

## 확장 Done 판정 로직 (Raw Data와 동일)
- **Start Done**: `actual_start_date` 존재 OR `status_raw ∈ (rectified/complete/completed/closed/verified)` OR `actual_progress_pct > 0` OR `actual_rectified_date/closure_date` 존재
- **Rectified Done**: `actual_rectified_date` 존재 OR `status_raw ∈ (rectified/…/verified)` OR `actual_closure_date` 존재 OR `actual_progress_pct ≥ 100`
- **Closure Done**: `actual_closure_date` 존재 OR `status_raw ∈ (closed/verified)`

## 변경 사항

### 1. `defect_snag_progress_totals` RPC 수정
- `actual_upto`를 현재의 좁은 정의(`asd IS NOT NULL AND asd <= as_of AND s_done`)에서 **확장 Done 카운트** 자체로 변경.
  - Start: `actual_upto = sdc` (기존 done_upto와 동일)
  - Rectified: `actual_upto = rdc`
  - Closure: `actual_upto = cdc`
- 결과: `done_upto == actual_upto`가 되어 KPI 카드/Total과 'Up to 21-Jul' 누계 셀이 완전히 일치.
- `plan_upto`는 기존 로직 유지(계획일 <= as_of 기준).

### 2. `defect_snag_progress_cells` RPC 유지
- 일별 셀은 실제 날짜(asd/acd/axd) 이벤트만 카운트 (현재 로직 유지).
- 무일자 Done은 SnagProgressPage의 'Up to 21-Jul' 컬럼(totals 기반)이 흡수하므로 별도 처리 불필요.

### 3. 클라이언트 코드
- `SnagProgressPage.tsx`는 이미 `totalsCumQ`(7/21 as_of)로 'Up to 21-Jul' 컬럼을 구성하므로 자동 반영됨. 코드 수정 없음.

## 검증
마이그레이션 후 Plot D · ARCH · Start 기준:
- Total done_upto == actual_upto == 1,010 (Raw Data start_status=Done 카운트와 일치)
- 'Up to 21-Jul' 누계 + 7/22 이후 일별 실적 합 = 최종 Actual Total
- Rectified/Closure도 동일 원칙 적용
