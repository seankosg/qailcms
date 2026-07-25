# TM Raw Data 댓글 표시 컬럼 추가

## 목표
TM Raw Data 테이블에서 댓글이 달린 항목에 말풍선 아이콘 + 댓글 수를 표시하고, 사용자별 읽음/안읽음 상태를 시각적으로 구분.

## 구현 내용

### 1. 신규 컬럼 `__comments` 추가 (Task No 왼쪽 고정)
- `TaskManagementRawDataPage.tsx`의 컬럼 배열에서 `["__select", "__comments", "task_no", ...frozenExtras, ...rest]` 순으로 배치.
- 컬럼 너비 약 60px (아이콘 + 숫자만 표시되도록 좁게).
- 항상 고정(frozen) — 사용자 컬럼 설정에서 숨김/이동 불가.
- 헤더는 `MessageCircle` 아이콘만 표시.

### 2. 댓글 수 집계
- 현재 페이지의 `rows`에서 `id` 목록 추출.
- 서버 함수 `getTaskCommentCounts` 신설 (`src/lib/task-management/comments.functions.ts`):
  ```ts
  createServerFn({ method: "POST" })
    .inputValidator(z.object({ taskRawIds: z.array(z.string().uuid()) }))
    .handler(async ({ data }) => {
      // task_comments에서 task_raw_id별 count + max(updated_at) 반환
      return { [id]: { count, lastUpdatedAt } }
    })
  ```
- `useQuery`로 페이지 rows 변경 시 재조회.

### 3. 사용자별 읽음 상태 관리 (localStorage 방식)
- 서버 저장은 부하가 크므로 **localStorage 사용** — 키: `tm-comments-read::${userId}`.
- 값: `{ [taskRawId]: lastReadAt(ISO) }`.
- 셀 렌더링 판단:
  - `count === 0` → 아이콘 미표시 (혹은 회색 빈 아이콘 없이 공백).
  - `lastReadAt >= lastUpdatedAt` → 회색 (`text-muted-foreground`).
  - 미확인/신규 → 진한 색 (`text-primary` + 굵은 숫자).
- 댓글 아이콘 클릭 시 상세페이지(TaskDetailPage)로 이동하며, 이동 시점의 `lastUpdatedAt`을 localStorage에 저장 → 회색 처리.

### 4. UI 세부
- 셀 내용: `<MessageCircle size=14 /> <span>{count}</span>` (한 줄, 중앙 정렬).
- 클릭 영역 전체가 상세 페이지 이동 트리거 (기존 Task No 클릭 동선과 동일).
- 스티키 배경은 기존 규칙대로 100% 불투명 유지.

## 기술 세부
- 파일: 
  - 신규: `src/lib/task-management/comments.functions.ts` (count 집계 서버 함수)
  - 신규: `src/lib/task-management/useCommentReadState.ts` (localStorage 훅)
  - 수정: `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (컬럼 정의, 렌더러, frozenColIds에 `__comments` 포함)
- 서버 저장 방식은 요청대로 "어려우면 말할 것" 옵션 — **localStorage로 진행 예정** (사용자별 브라우저 로컬 저장, 서버 부담 없음, 기기 간 동기화는 안 됨). 서버 저장이 필요하면 알려주세요.
