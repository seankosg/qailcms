
## 목표

Spare Part 상세페이지의 `SparePartStatusHistory` 컴포넌트가 제공하는 **카테고리 태그 + 스레드형 댓글/답글 + 인라인 수정/삭제 + Realtime 반영** 기능을, 세 Raw Data 도메인의 상세창에 동일하게 이식한다.

- ABD: `AbdDetailSheet` (Sheet)
- SM(Defect): `DefectDetailPage`
- TM(Task): `TaskDetailPage`

기존 `defect_status_history` / `task_management_status_history` / `abd_change_log` 은 **필드 변경 감사 로그**로서 유지하고, **새 댓글 테이블을 도메인별로 별도 신설**한다(스키마/RLS 격리, Spare Part와 완전 대칭).

## 데이터 모델 (신설 3개 테이블)

Spare Part의 `spare_part_status_history` 컬럼 형태를 그대로 재사용:

```text
{abd|defect|task}_comments
- id uuid PK
- {abd_item_id | defect_raw_id | task_raw_id} uuid FK  ← 도메인 부모행
- parent_comment_id uuid null  ← 답글 지원
- category text ('technical'|'supplier'|'internal'|'general')
- message text (<=2000)
- source text default 'app_manual'
- author_user_id uuid null (auth.users)
- edited boolean default false
- created_at / updated_at timestamptz
- GRANT authenticated / service_role, RLS on
```

### RLS 정책 (Spare Part와 동일 규칙)
- SELECT: 로그인 사용자 전체
- INSERT: `author_user_id = auth.uid()`
- UPDATE/DELETE: 본인 작성분 또는 admin/superuser (`has_role`)

### 카테고리 옵션 (도메인별 조정)
- ABD: `drafting`, `submission`, `dar`, `general`
- SM: `defect`, `rectification`, `inspection`, `general`
- TM: `plan`, `execution`, `handover`, `general`
- (카테고리 라벨/색상은 상수 맵으로 각 컴포넌트에 정의)

## 컴포넌트 구조

### 1. 공용 훅 (도메인별 3종)
`src/hooks/useAbdComments.ts`, `useDefectComments.ts`, `useTaskComments.ts`
- `useSparePartStatusHistory` 와 동일한 구조: `useQuery` + Realtime `postgres_changes` 구독 → `invalidateQueries`.

### 2. 프레젠테이션 컴포넌트 (도메인별 3종)
`src/components/abd/detail/AbdCommentsThread.tsx`
`src/components/defect-management/detail/DefectCommentsThread.tsx`
`src/components/task-management/detail/TaskCommentsThread.tsx`

- 각각 `SparePartStatusHistory.tsx` 를 템플릿으로 복제:
  - 카테고리 셀렉트 / Textarea / Send / Reply / Edit / Delete / 시간표시(`formatDistanceToNow`) / 작성자 이름(`profiles.display_name`)
  - `useCurrentUser` 로 편집권한 판정 (`isAdmin` 또는 본인)
- **중복 로직이 크므로**, 초기 구현은 3개 파일로 복제하되 카테고리/훅/부모키 필드명만 파라미터화 가능한 형태로 정리(추후 필요 시 하나로 통합).

### 3. 상세창 통합
- `AbdDetailSheet.tsx`: 하단 "Raw Payload" 위에 `<h3>Comments</h3>` 섹션 추가 후 `<AbdCommentsThread abdItemId={item.id} />`
- `DefectDetailPage.tsx`: Status History 카드 아래에 Comments 카드 추가
- `TaskDetailPage.tsx`: Status History 카드 아래에 Comments 카드 추가

## 마이그레이션 순서

1. 3개 테이블 생성 + GRANT + RLS + 정책 + `updated_at` 트리거 + `parent_comment_id` / 부모FK 인덱스.
2. 훅 3개 신설.
3. 스레드 컴포넌트 3개 신설.
4. 각 상세창에 삽입.

## Spare Part와 다른 점 (질문 필요 없음, 아래대로 진행)

- 부모행 키가 도메인별 상이(`abd_item_id` / `defect_raw_id` / `task_raw_id`) → 각 훅·컴포넌트 시그니처가 다름.
- 카테고리 값이 도메인 특성에 맞게 다름(위 목록).
- `source_file_hash` 는 Spare Part 전용(엑셀 임포트 마이그레이션 대비)이므로 신규 테이블에서는 제외.
- 나머지 UI(색상 팔레트, 답글 트리, 편집 UX, Realtime)는 100% 동일.

## 변경/유지 파일 요약

Add:
- migration: 3 tables + policies
- `src/hooks/useAbdComments.ts`, `useDefectComments.ts`, `useTaskComments.ts`
- `src/components/abd/detail/AbdCommentsThread.tsx`
- `src/components/defect-management/detail/DefectCommentsThread.tsx`
- `src/components/task-management/detail/TaskCommentsThread.tsx`

Modify:
- `src/components/abd/raw-data/AbdDetailSheet.tsx`
- `src/components/defect-management/detail/DefectDetailPage.tsx`
- `src/components/task-management/detail/TaskDetailPage.tsx`

기존 `*_status_history` / `abd_change_log` 는 변경 없음(감사로그로 유지).
