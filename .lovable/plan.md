# SM Raw Data 1회 마이그레이션 계획

## 목적
업로드 파일 `ELECT_open_snagging_-_전기_2026-07-20.R2.xlsx`(8,260행)의 `ID`를 `defect_items_raw.source_issue_no`와 매칭하여, `Start Status` / `Completion Status` / `Closure Status` 컬럼 값을 기반으로 각 actual date를 1회 업데이트합니다. Start/Rectified/Closure status는 파생 로직이 자동 계산합니다.

## 매핑 규칙 (사용자 확정)
| 파일 컬럼 | 조건 | DB 업데이트 대상 | 채울 값 |
|---|---|---|---|
| Start Status | `= "Done"` | `actual_start_date` | Data Date (`2026-07-20`) |
| Completion Status | `= "Done"` | `actual_rectified_date` | Data Date (`2026-07-20`) |
| Closure Status | 날짜 값 존재 (`YYYY-MM-DD`) | `actual_closure_date` | 셀의 날짜값 그대로 |

- 파일 값이 있으면 기존 DB 값을 **덮어쓰기**.
- 파일 값이 비어있는(NaN) 컬럼은 해당 필드를 건드리지 않음(원본 유지).
- 매칭 실패한 ID는 스킵 리포트에 기록.
- Data Date는 파일명 및 `Start/Completion Status='Done'` 행의 실무 기준일인 **2026-07-20**을 사용.

## 실행 절차
1. 업로드 파일을 파이썬으로 읽어 `ID`, `Start Status`, `Completion Status`, `Closure Status`만 추출하고, Closure의 날짜 문자열을 ISO date로 정규화.
2. 유효 레코드만 CSV로 저장 후 임시 스테이지 테이블 `_tmp_sm_actual_dates_20260721(source_issue_no text, actual_start_date date, actual_rectified_date date, actual_closure_date date)`에 적재.
3. 단일 마이그레이션에서:
   - 스테이지 테이블 생성
   - `INSERT`로 데이터 로드 (Python으로 생성한 VALUES 사용)
   - `UPDATE defect_items_raw t SET ... FROM stage s WHERE t.source_issue_no = s.source_issue_no` — 각 컬럼은 `COALESCE(s.col, t.col)` 대신 `CASE WHEN s.col IS NOT NULL THEN s.col ELSE t.col END`으로 처리해 파일에 값이 있는 컬럼만 덮어씀
   - 파생 필드(`start_status`, `rectified_status`, `closure_status`)는 기존 트리거/뷰가 재계산
   - 매칭 통계(`updated_rows`, `unmatched_ids`) 로그 후 스테이지 테이블 DROP
4. 실행 후 검증:
   - `SELECT count(*) WHERE actual_start_date = '2026-07-20'` 등으로 스팟체크
   - Excel의 상위 20개 ID를 샘플로 before/after 비교
   - 파생 필드가 정상 표시되는지 SM Raw Data 페이지에서 확인

## 결과물
- 단일 마이그레이션 SQL 1건 (실행 후 스테이지 테이블 자동 정리)
- 실행 요약: 대상 행 수 / 업데이트 성공 / 미매칭 ID 목록

## 기술 참고
- `defect_items_raw`에는 `start_status`/`completion_status` 물리 컬럼이 없음. `start_status`는 `origin='derived'`, `rectified_status`/`closure_status`는 `aconex` 소스로 저장되나, 이 마이그레이션에서는 actual date만 채워 파생 로직에 위임.
- 파일 상위 8,260행 중 Start/Completion Status='Done' 각 495건, Closure Status(날짜) 246건이 실제 업데이트 대상.
