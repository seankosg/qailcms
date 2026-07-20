## 변경 요약

TM Raw Data 상세페이지(`src/components/task-management/detail/TaskDetailPage.tsx`) 오른쪽 사이드바에서 **Status History 카드를 완전히 제거**하고, 그 자리에 **Comments 카드**만 남깁니다. Comments 기능 자체는 이미 해당 컬럼 하단에 구현되어 있으므로 신규 개발 없이 위치와 노출만 재정리합니다.

## 세부 작업

1. `TaskDetailPage.tsx`
   - 오른쪽 컬럼(`<div className="space-y-3">`) 내부의 Status History 렌더링 블록(약 180~209행) 삭제.
   - Comments 카드는 그대로 유지하되, 이제 사이드바 최상단에 위치.
   - Status History 조회에 사용되던 코드 정리:
     - `useQuery`(`task-detail-history`) 훅 제거
     - `getTaskHistory` / `useServerFn` / `fetchHistory` 관련 import 및 변수 제거
     - `SOURCE_COLORS` 상수 제거 (다른 곳에서 미사용)
     - `onFieldSaved`에서 `queryClient.invalidateQueries(["task-detail-history", ...])` 호출 제거 (필드 저장 시 여전히 `refetch()`로 상세 데이터는 최신화)

2. 미사용 import 정리
   - `useQueryClient`가 다른 용도로 필요 없으면 제거, 필요하면 유지.
   - `getTaskHistory` import 제거.

## 영향도

- `getTaskHistory` 서버 함수 자체는 삭제하지 않음 (다른 화면에서 참조할 가능성 대비).
- Comments 기능(`CommentsThread`, `task_comments` 테이블, RLS 정책 등) 변경 없음.
- 좌측 필드 편집 영역, 헤더, 리프레시 버튼 등 나머지 UI는 그대로 유지.
