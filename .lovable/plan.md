## 근본 원인

`src/components/task-management/detail/TaskDetailPage.tsx` 는 편집 가능 여부를 오직 `isAdmin` 만 보고 판단합니다.

- L47~51: `isAdmin`, `isSuperUser`, `isDSuperUser` 만 계산, `senior_user`/`user`/Owner 케이스 없음.
- L103~111: 헤더 배지는 `isAdmin ? 편집 : 읽기전용` 이분법.
- L180: `let effectiveCanEdit = isAdmin;` 이 모든 필드의 기본값 → HDEC PIC(User) 로 로그인해도 team/data_date 외 모든 셀 잠김.

반면:
- Raw Data 리스트(`TaskManagementRawDataPage.tsx`)는 `canEditRawRow(user, "task_management_raw", row)` 로 판정하고 있어 리스트에선 편집 가능.
- DB RLS(`User+ can update task_management_raw`)는 `user`/`senior_user`/`superuser`/`d_superuser`/`admin` 모두 UPDATE 를 허용 → 서버 측 차단 없음. 순수 UI 게이트 오류.

즉, "리스트에선 편집되는데 상세에선 읽기전용" 은 상세 페이지가 리스트와 다른(더 엄격한) 자체 규칙을 쓰기 때문입니다.

## 수정 방침 (UI 한정, 로직/DB 변경 없음)

`TaskDetailPage.tsx` 의 게이트를 리스트와 동일한 `canEditRawRow` 로 통일합니다.

1. `import { canEditRawRow } from "@/lib/auth/roles";` 추가.
2. `const canEditRow = canEditRawRow(user as any, "task_management_raw", row);` 를 row 로드 후 계산.
   - `senior_user`↑ = 전체 편집
   - `user` = HDEC PIC/ENG/Subcon/Subsub 이름 일치 시 편집 (Owner)
   - `d_superuser` = team 일치 시 편집
3. 헤더 배지(L103~111): `canEditRow` 로 판정.
   - true → 초록 "편집" 배지 (Owner 인 경우 `KeyRound` 아이콘 + "Owner 편집" 라벨로 구분).
   - false → 기존 "읽기전용".
4. 필드 루프 내 `effectiveCanEdit` 초기값을 `isAdmin` → `canEditRow` 로 변경.
   - `task_no` 오버라이드는 그대로 `canEditTaskNo`(admin/d_superuser) 유지.
   - `team`/`data_date` 오버라이드는 그대로 `canEditOwnerFields`(admin/superuser/Owner) + 서버 fn 경로 유지.
   - 그 외 컬럼은 `canEditRow` 로 편집 여부 결정 → 실제 저장은 기존 `EditCellPopover` 기본 경로(supabase update)를 사용하며 RLS 가 최종 승인.
5. 부가: `actual_progress` 는 `isParent` 일 때 편집 불가 로직 유지.

## 검증

- 타입체크 후 자동 재빌드.
- 실제 확인:
  - HDEC PIC=본인인 Task 상세 진입 → 배지 "편집(Owner)", 셀 hover 시 편집 UI 노출, 저장 성공.
  - PIC 불일치 Task 진입 → "읽기전용" 배지, 편집 UI 미노출.
  - Admin 로그인 → 기존과 동일하게 전체 편집.

## 범위

- 변경 파일: `src/components/task-management/detail/TaskDetailPage.tsx` 단 1개.
- DB/서버 함수/RLS/스키마 변경 없음.
- ABD/SM 상세 페이지에도 같은 패턴 문제가 있는지는 이번 화급 건 범위 밖 — 필요 시 후속 처리(요청 주시면 동일 방식으로 정리).
