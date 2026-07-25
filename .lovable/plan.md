# My Work Space — 내 항목 댓글 리스트

## 목표
사용자가 담당(HDEC PIC/Team, 관리자 = 전체)하는 4개 모듈(TM / SM / ABD / Spare Part)의 항목에 달린 댓글을 한 곳에 모아 보여주고, 각 댓글의 읽음/안읽음 상태를 사용자별로 기억.

## UI 배치
`src/components/my-work-space/MyWorkSpacePage.tsx` 상단 KPI 영역 하단, 모듈 리스트 위에 새 섹션 **"내 항목 댓글"** 카드 추가.
- 헤더: 제목 + 미확인 총합(빨간 pill) + "모두 읽음 처리" 링크 + 접기/펼치기 토글.
- 탭: `전체 · TM · SM · ABD · SP` (각 탭에 미확인 카운트 배지).
- 각 탭은 스크롤 영역(max-h-96) 안의 카드 목록.
- 기본 정렬: `updated_at desc`. 최신 20건씩 무한 스크롤(더보기 버튼).
- MyWorkSpacePage와 MyTeamWorkSpacePage 모두 재사용(scope=`pic`/`team` 전달).

## 각 댓글 카드에 표시할 정보
```
[모듈 배지] [카테고리 배지] [●안읽음 dot]         xx분 전
Task/Issue No · 항목명(요약)                       [바로가기 →]
"댓글 본문 최대 2줄 말줄임"
작성자 · (수정됨) · 부모 상세로 이동 (전체 카드 클릭)
```
- 안읽은 카드: 배경 `bg-primary/5`, 좌측 2px `border-l-primary`, 굵은 텍스트.
- 읽은 카드: 기본 배경, 회색 텍스트.

## 데이터 소스
4개 테이블: `task_comments`, `defect_comments`, `abd_comments`, `spare_part_comments`.
필터: 관리자면 전체, 아니면 부모 테이블의 `hdec_pic_name = 나` (팀 스코프면 `team = 내팀`).

### 조회 방식
효율/RLS를 고려해 **서버 함수 1개** `getMyWorkspaceComments`(`src/lib/my-work-space/comments.functions.ts`) 신설:
- 입력: `{ scope: "pic" | "team", filterValue: string | null, isAdmin: boolean, module: "all"|"tm"|"sm"|"abd"|"sp", limit, before }`.
- 각 모듈별로 (a) 담당 부모 ID 목록을 조회한 뒤 (b) 해당 부모 ID 배열로 댓글 테이블을 `updated_at desc`로 pagination. 반환 DTO:
```ts
{ items: Array<{
  id, module, category, message, source, author_user_id,
  created_at, updated_at, edited,
  parent_id, parent_ref, parent_label, // 예: task_no + task_name
  detail_href // 상세 페이지 라우트
}>; nextBefore: string | null; unreadTotal: Record<Module,number> }
```
- 관리자 스코프: 부모 필터 없이 최근 200건 제한.
- 정렬/페이징: `updated_at`+`id` 커서. 미확인 카운트 계산은 클라이언트가 읽음 맵과 대조.

### Realtime
`supabase.channel("mws-comments-<userId>")`에 4개 테이블 postgres_changes 구독 → 발생 시 쿼리 무효화(디바운스 500ms).

## 읽음 상태 관리
- 기존 `useCommentReadState`는 `taskRawId → lastReadAt` 구조 → 새로 `useCommentInboxRead` 훅 추가.
- 키: `qail.mws.comments-read::<userId>`, 값: `{ [commentId]: readAtISO }`.
- `isRead(comment)` = 저장된 값이 `comment.updated_at` 이상.
- markRead 트리거:
  1. 카드의 "바로가기 →" 클릭 또는 카드 전체 클릭 시.
  2. "모두 읽음 처리" 클릭 시 현재 탭의 모든 항목.
  3. 카드가 뷰포트에 1초 이상 노출된 경우(IntersectionObserver 옵션, 기본 활성).
- 안읽은 총합/탭별 카운트는 훅+로컬 상태로 실시간 갱신.

## 라우팅(바로가기)
- TM: `/closure/task-management/detail/$id`
- SM: `/closure/snag-list/detail/$id` (기존 라우트 확인)
- ABD: `/closure/abd/raw-data?open=<id>` (AbdDetailSheet 오픈 파라미터)
- SP: `/closure/spare-part/detail/$doc_ref` (기존 라우트)
클릭 시 해당 route로 navigate + 방금 클릭한 comment.id를 markRead.

## 파일 변경 요약
신규
- `src/lib/my-work-space/comments.functions.ts` — createServerFn `getMyWorkspaceComments`.
- `src/hooks/useCommentInboxRead.ts` — 사용자별 읽음 맵.
- `src/components/my-work-space/CommentsInbox.tsx` — 탭/리스트/카드 UI.

수정
- `src/components/my-work-space/MyWorkSpacePage.tsx` — 새 섹션 삽입, scope/filterValue/isAdmin 전달.

## 검증
- 사용자가 담당한 태스크에 댓글 달면 5초 이내 인박스에 뜨고 미확인 카운트 증가.
- 카드 클릭 → 상세 페이지로 이동, 재접속 시 해당 카드는 회색.
- "모두 읽음 처리" → 미확인 카운트 0.
- 관리자 계정에서는 전 항목 노출.
- 팀 워크스페이스에서는 팀 기준으로 필터 노출.
