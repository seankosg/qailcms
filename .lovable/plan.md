## TM 상세페이지 — Team/Data Date 소유자 편집 + 비편집 필드 음영

### 1) 편집 권한 확장 (Team, Data Date)

대상 필드: `team`, `data_date` (현재 둘 다 `editable: false`).

허용 조건 (OR):
- `isAdmin || isSuperuser` (**d_superuser는 제외 — superuser 하위**)
- Owner: `user.hdec_pic_name` (trim, case-insensitive) === `row.hdec_pic_name`

구현 위치: `src/components/task-management/detail/TaskDetailPage.tsx`
- `useCurrentUser`에서 `hdec_pic_name` 사용 (없으면 훅에 필드 노출 보강).
- 렌더 루프에서 `task_no` 오버라이드 패턴과 동일하게:
  - `team` → `{ ...c, editable: true, editorType: "select", options: DISCIPLINES }` (ARCH/ELEC/MECH/DESN/PRJC)
  - `data_date` → `{ ...c, editable: true, editorType: "date" }`
- `effectiveCanEdit`: 위 조건에 따라 개별 판정.
- 전역 `TM_COLUMNS`는 변경하지 않음 → Raw Data 인라인 편집·Bulk Edit 화이트리스트에 영향 없음.

### 2) 저장 경로 — 서버 함수 (RLS 확장 대신)

`EditCellPopover`의 직접 update는 관리자 전용 RLS에 막힐 수 있으므로 서버 함수 신설.

- 신규 파일: `src/lib/task-management/owner-mutations.functions.ts`
- `updateTaskOwnerField` (POST, `requireSupabaseAuth`)
  - 화이트리스트: `["team", "data_date"]`
  - 권한: `has_role(admin) || has_role(superuser)` OR 대상 행의 `hdec_pic_name`이 caller의 `profiles.hdec_pic_name`과 일치
  - `updated_by`, `updated_at` 세팅 후 `supabaseAdmin`으로 update (열 단위 안전, RLS 우회 최소화)
- `EditCellPopover`에 `onSave?: (val) => Promise<void>` prop 추가 → 상세페이지의 Team/Data Date는 이 서버 함수로 저장, 그 외 기존 동작 유지.

### 3) 비편집 필드 음영 처리

`TaskDetailPage.tsx` 필드 값 컨테이너에 조건부 클래스:
- 비편집: `bg-muted/50 text-muted-foreground rounded px-1.5 py-0.5`
- 편집 가능: 기존 hover 스타일 유지
- 다크모드 호환 토큰 `bg-muted/50` 사용

규칙:
- **음영 있음 = 편집 불가** (자동계산·시스템·권한 부족 포함)
- **음영 없음 = 편집 가능** (팝오버 트리거)

### 4) 기본안 (별도 언급 없으면 이대로 진행)

- Owner 매칭: `hdec_pic_name` 단독 (hdec_eng_name은 제외)
- Team 편집: DISCIPLINES 5종 select (자유 입력 아님)
- 저장: 서버 함수 신설

바로 구현 진행합니다.