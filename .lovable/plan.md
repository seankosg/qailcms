# TM Raw Data — 신규 Task 추가 기능 (개정 5, 확정)

## 목표
TM Raw Data에서 Main Task + Sub Task(≥1) 원자적 신규 등록. Main Task No 편집 시 Sub No 실시간 재계산. 필수/선택 필드 명확 구분. Sub 값으로 자동 롤업(DB `update_task_summary` 활용). 저장 조건 미충족 현황을 저장 버튼 옆 실시간 pill로 표시.

## DB 실측 반영
- `task_management_raw.discipline`은 `NOT NULL`이고 Main/Sub 항상 동일 → Main에서만 필수 입력, Sub는 상속
- `update_task_summary(_discipline, _parent_task_no)`가 롤업: `plan_start(MIN)`, `plan_end(MAX)`, `plan_days`, `actual_start`, `actual_finish`, `actual_duration`, `actual_progress`, `plan_progress`, `progress_variance`, `forecast_end`, `slip_days`, `auto_judgment`, `is_rollup=true`
- 롤업 대상 아님 → Main에서 사용자 직접 입력: `risk`, `hdec_pic_name`, `hdec_eng_name`, `category`, `team`, `plot`, `floor_level`, `location`, `row_type`

## 필수 / 선택 필드

### Main Task (사용자 입력)
**필수 (`*`)**: Discipline, Task No(프리필·편집 가능), Task 이름, Team, Category, HDEC PIC, Risk
**선택**: HDEC ENG, Level, Location, Plot, Work Type
**자동 롤업 (회색, 편집 불가, "Sub Task에서 자동 계산" 힌트)**: P.Start, P.Finish, Plan Days, A.Start, A.Finish, Actual %, Plan %, Variance, Forecast End, Slip Days, Auto Judgment

### Sub Task (행마다, ≥1)
**필수 (`*`)**: Task 이름, Sub-Task 설명, Work Type, Risk, HDEC PIC, Category, P.Start, P.Finish(≥ P.Start)
**자동/기본값**: Status = `예정`, Discipline = Main 값 상속
**선택**: HDEC ENG, Level, Location
Sub Task No는 `<Main No>-NN` 자동 표시(편집 불가)

## 저장 조건 미충족 실시간 표시

**위치**: 다이얼로그 푸터, `[취소]` 와 `[저장]` 사이 (모바일은 저장 버튼 위 stack)

**상태별 pill**
- **미충족**: 붉은 pill `⚠ 필수 N개 미입력` — 저장 disable. tooltip에 항목 리스트(예: "Main HDEC PIC · Sub #2 Work Type · Sub #2 P.Finish"), 5개 초과 시 "+N건"
- **날짜 위반**: 앰버 pill `⚠ 날짜 오류 N건` (P.Finish < P.Start 등) — 저장 disable. tooltip에 위반 행
- **모두 충족**: 초록 pill `✓ 저장 가능` — 저장 활성
- **저장 중**: 스피너 + "저장 중…"

**동작**: 폼 state에서 즉시 파생(서버 왕복 없음). 미입력 필드 라벨/테두리 붉게 강조. pill 클릭 시 첫 미충족 필드로 스크롤+focus.

## Main / Sub Task No 실시간 연동
- Main No 편집 → `subTaskNos[i] = ${mainNo}-${String(i+1).padStart(2,'0')}` 즉시 재계산
- Sub 추가/삭제/이동 시 순번 재부여
- 서버는 최종 확정 Main No 기준 재채번, 미리보기와 100% 일치

## 채번
- 신규 RPC `allocate_main_task_no(_discipline)`: discipline별 접두어 최대치 다음 번호 (예 `AR-C-T-12` → `AR-C-T-13`). 없으면 `NEW-001`. 결과 중복 시 auto-increment
- Sub: 신규 Main이므로 `-01`부터. `create_main_with_subs`에서 원자 처리

## 롤업 정책 (확정)
저장 트랜잭션 마지막에 `update_task_summary(_discipline, main_task_no)`를 항상 자동 실행 → 진도율·판정 등 즉시 반영. 이후 Sub 편집 시 기존 트리거 파이프라인이 계속 동작.

## 권한
- guest / super_guest: 403
- user: HDEC PIC/ENG = 본인, team 강제
- d_superuser: team 강제
- senior_user / superuser / admin: 제약 없음
클라이언트 동일 판정 → 버튼 disable + tooltip 사유

## 서버 인터페이스
```
addMainTaskWithSubs({
  discipline,
  main: {
    task_no?, task_name, team, category, hdec_pic_name, risk,
    hdec_eng_name?, floor_level?, location?, plot?, row_type?
  },
  subs: [{
    task_name, sub_task_desc, row_type, risk,
    hdec_pic_name, category, plan_start, plan_end,
    hdec_eng_name?, floor_level?, location?, status_manual?
  }, ...]  // >=1
}) → { main_task_no, sub_task_nos[] }
```
SQL 함수 `create_main_with_subs`가 원자성 보장(Zod + SQL NOT NULL 이중 검증, 실패 시 롤백). 저장 직후 `update_task_summary` 호출.

## 파일 변경
- 신규: `src/components/task-management/raw-data/AddMainTaskDialog.tsx` (푸터 pill 포함)
- 수정: `TaskManagementRawDataPage.tsx` (툴바 "Task 추가" 버튼 배선)
- 수정: `src/lib/task-management/hierarchy.functions.ts` (`addMainTaskWithSubs`, 권한/롤업 헬퍼)
- 마이그레이션: `allocate_main_task_no`, `create_main_with_subs`

## 검증
- 필수 누락 → 붉은 pill/개수/툴팁 정확성
- 날짜 위반 → 앰버 pill, 저장 disable
- 모두 충족 → 초록 pill, 저장 활성
- Main P.Start/P.Finish = Sub MIN/MAX (저장 후 DB 확인)
- Main No 편집 시 Sub No 즉시 갱신
- Sub 추가/삭제 순번 재부여
- 저장 직후 `update_task_summary` 자동 실행으로 진도율·판정 반영
- guest 차단, user 소유권/team 강제, 채번 중복 처리