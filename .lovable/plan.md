## 문제

TM Raw Data 페이지 쿼리가 `.limit(10000)`로 되어 있지만, PostgREST 기본 응답 상한(1000행)에 걸려 실제로는 최대 1000행만 반환됩니다. 결과적으로 데이터가 1000행을 넘으면 화면에 잘려서 보입니다. UI 자체에는 페이지네이션이 없으므로(테이블 가상화만 있음) 서버 페치 로직만 페이지 반복으로 바꾸면 됩니다.

## 변경 계획

**파일:** `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`

- L327-339의 `useQuery` 내부 `queryFn`을 페이지 반복(range) 방식으로 교체
  - `pageSize = 1000`으로 `.range(from, from + pageSize - 1)` 반복
  - 반환 행 수 < pageSize 이면 종료
  - 정렬(`discipline`, `sort_order`)과 필터 없음(전량 로드) 유지
  - 기존 `fetchAllByUploadId`와 동일한 패턴을 인라인 헬퍼로 작성 (upload_id 조건이 없어 재사용 불가)
  - 안전 상한: 예: `from > 200000`이면 중단 (무한 루프 방지)

로직/UI 변경 없음(정렬/필터/컬럼/가상화 그대로). SM·ABD Raw Data가 이미 사용하는 패턴과 동일합니다.

## 검증

- 페이지 재로드 시 전체 행 수가 이전 대비 증가하는지 콘솔/네트워크 탭에서 확인
- 상단 카운트/스크롤로 1000행 이상 표시 확인
