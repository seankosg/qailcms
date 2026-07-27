## 목표
현재 TM > Import Logs > **Import Record** 탭의 사용자×일자 매트릭스에, 각 사용자의 **일별 수동 편집(manual edits)** 집계를 **같은 셀에 병기**한다. 대상 사용자·기간·팀 필터 등 기존 UX는 유지.

## 데이터 소스
- 편집 소스: `public.task_management_status_history` where `source = 'manual'`
- 집계 축:
  - `changed_by` → `profiles.id` (HDEC PIC 사용자)
  - Doha(Asia/Qatar) 로컬 날짜 = `date_trunc('day', changed_at AT TIME ZONE 'Asia/Qatar')`
- 두 지표를 셀에 모두 표시:
  - **필드 변경 건수** = `count(*)` (status_history 행 수)
  - **수정 Task 수** = `count(distinct (discipline, task_no))`

## 서버 RPC 신설
`public.tm_edit_record_daily(p_from date, p_to date)` → `TABLE(user_id uuid, date_key date, edits_count int, tasks_count int)`
- security definer, `search_path=public`, admin/super만 실행 가능하도록 초입에서 `is_admin_or_super(auth.uid())` 체크 후 아니면 raise
- `changed_at`을 Doha TZ로 변환하여 그룹핑, `p_from ~ p_to`(포함) 범위
- 인덱스: 기존 `tmsh_changed_at_idx` 활용
- GRANT EXECUTE TO authenticated

## 프론트엔드 수정: `src/components/import-log/task-management/TmImportRecordTab.tsx`
1. 신규 쿼리 `edits-record-daily` 추가 → RPC 호출
2. `editMap: Map<"userId|dateKey", {edits: number; tasks: number}>` 구성
3. `MatrixTables` 셀 렌더 변경:
   - 업로드 있음: 기존 `Check` 아이콘 유지
   - 그 아래(또는 옆) 작은 뱃지로 `E{edits}/T{tasks}` (편집이 0이면 표시 안 함)
   - 셀 tooltip: `업로드 N건 · 편집 E필드 / T Task`
   - 셀 최소 폭이 좁으므로 세로로 2줄(1줄: ✓/✗, 2줄: `E·T` 소형 텍스트)로 배치
4. 팀 헤더 뱃지에 "오늘 편집 X명" 추가
5. 사용자 행 우측 합계 컬럼에 "업로드 N일 / 편집 M일" 병기

## Excel 내보내기: `exportTmImportRecord.ts`
- 시그니처에 `editMap` 추가
- 각 날짜 셀에 `"✓" | ""` 대신 `"U | E{n}/T{m}"` 형태로 결합, 또는 컬럼을 2개(업로드/편집)로 분리해 병기
- (구현은 단일 셀 문자열 병기 방식 채택하여 컬럼 폭 폭증 회피)

## 권한/영향 범위
- Import Record 탭 자체가 admin/superuser 전용이라 신규 RPC 접근도 동일 게이트
- 다른 모듈(SM/ABD/DMR) Import Logs UI에는 영향 없음

## 기술 세부
- 편집 카운트에서 시스템 rollup/import 소스는 제외(사용자 답변 반영: manual만)
- 필드 변경 다수(예: plan_start/plan_end/forecast_end 3개 동시 저장) 시 3건으로 계산 — status_history가 필드 단위 row로 남는 구조를 그대로 사용
- 대량 편집 이력이 있을 수 있으므로 클라이언트에서 페이지네이션 대신 RPC 서버측 GROUP BY로 집계 결과만 전송(경량)