## B 목록 정밀 감사 결과

파일별 실측(코드 라인 인용 포함):

| # | 파일 | 실측 결과 | 상한 위반? |
|---|---|---|---|
| 1 | `src/hooks/useAbdAttentionInbox.ts` L71–78 | `const LIMIT = 5000; …select().limit(LIMIT)` — 단일 요청 | **YES.** PostgREST가 1,000행에서 잘라 Attention 리스트가 최대 1,000건까지만 표시됨 |
| 2 | `src/components/task-management/tree/TaskTreePage.tsx` L273–280 | `from("task_management_raw").select(…).limit(10000)` — 단일 요청 | **YES.** Task 총량이 1,000 초과 시 트리에 일부 태스크가 아예 안 뜸(부모/자식 매칭 깨짐) |
| 3 | `src/hooks/useMyWorkspaceData.ts` L20–41 | 자체 `fetchAll()` 1,000행 청크 루프(MAX 200k) | NO. 이미 A방식 |
| 4 | `src/components/import/ImportLogsPage.tsx` L191/224/250/277 | 의도적 `.limit(100)`; profiles `.in(unique)` 는 ≤100 로그의 유저 id set | NO. 안전 |
| 5 | `src/components/task-management/schedule-revision/TaskScheduleRevisionPage.tsx` L474/519 | `RECENT_LIMIT=500`, UI에 "최근 500건" 명시 | NO. 의도적 캡 |
| 6 | `src/lib/abd/bulk-actions.ts` / `src/lib/task-management/bulk-actions.ts` / `src/lib/spare-part/bulk-actions.ts` / `src/lib/spare-part/bulk-edit.ts` | `.in(slice)` slice 크기 100–500 (chunk 루프) | NO. 안전 |
| 7 | `src/lib/defect-management/classifier/bulk-classify.functions.ts` L43–49 | `CHUNK=500` 청크 루프 | NO. 안전 |
| 8 | `src/components/spare-part/detail/SparePartStatusHistory.tsx`, `src/components/shared/CommentsThread.tsx` | 단일 부모(태스크/문서) 스레드 조회. 현실적으로 스레드당 < 1,000. profiles `.in(authorIds)` 도 소량 | 저위험. 표준화 대상 아님 |
| 9 | `src/routes/api/public/backup/archive-download.ts` L28 | `.limit(1)` | NO |
| 10 | ABD `abd_progress_cells/totals` 등 서버 집계 RPC | 서버 사이드 GROUP BY | NO. 상한 무관 |

**결론:** 실제 상한 위반은 2건 — `useAbdAttentionInbox`, `TaskTreePage`.

---

## 표준화 패치 계획

두 지점을 A방식(1,000행 청크 루프)으로 통일합니다. 신규 유틸을 만들지 않고 기존 `fetchAll()` 패턴(`useMyWorkspaceData.ts`)과 동일한 구조를 각 파일 내에 인라인으로 도입하여 사이드이펙트를 최소화합니다.

### 패치 1 — `src/hooks/useAbdAttentionInbox.ts`
- 기존 `.limit(5000)` 단일 요청을 **1,000행 청크 루프**로 교체.
- 안전 상한: `MAX_ROWS = 20_000`(현실 상한 초과 방어). 초과 시 마지막 페이지에서 중단하고 UI 상단에 "일부만 표시됨" 힌트를 남길 수 있는 값을 반환(추가 UI 필요 없으면 로그만).
- 정렬/필터 조건은 그대로 유지, 각 페이지에서 동일 `select`, `order`, 필터 재적용.
- 반환 계약(배열)은 동일 → 호출부(`AttentionInbox` 등) 무수정.

### 패치 2 — `src/components/task-management/tree/TaskTreePage.tsx`
- 로컬 `fetchAllTasks()` 헬퍼 추가(같은 파일 내 상단 함수). `useMyWorkspaceData`의 `fetchAll` 시그니처를 그대로 채용.
  - `PAGE=1000`, `MAX_PAGES=200`(=20만행 안전상한, TM 현 규모 대비 여유), `order("task_no", asc)` 유지.
- `.limit(10000)` 호출을 이 헬퍼로 대체.
- 반환 shape(배열) 동일 → 이후 트리 빌드/롤업 로직 무수정.
- 정합성 검증 QA:
  1) 총 태스크 수 `select("id",{count:"exact",head:true})`로 얻은 값과 로드된 배열 길이 일치 확인(개발 콘솔 로그로 임시).
  2) Main/Sub 카운트가 대시보드 KPI 총계와 일치하는지 육안 확인.
  3) 상용 반영 전 로그 제거.

### 안전 강화(옵션, 이번 계획엔 미포함)
- 공용 `paginatedSelect(table, opts)` 유틸을 `src/lib/supabase/paginate.ts`에 신설하는 안은 위험 지점이 2곳뿐이라 이번엔 보류. 향후 유사 케이스가 3건 이상 나오면 리팩터링.
- `CommentsThread`/`SparePartStatusHistory`는 스레드당 1,000건 초과가 발생하는 순간만 문제이므로, 관찰 후 필요 시 별도 패치.

---

## 검증 절차 (패치 후)
1. `bun run typecheck` 통과.
2. ABD Attention 인박스: DB에 Attention 대상 1,000건 초과인 팀 계정으로 확인 → 카운트가 서버 count와 일치.
3. TM Task Tree: 전체 태스크 수 > 1,000인 상태에서 트리 로드 → 루트 및 리프 개수와 KPI 총계 일치.
4. Raw Data / MWS / 대시보드에 회귀 없는지 스팟체크.

## 롤아웃
- 두 파일만 단일 커밋으로 수정. DB 변경 없음. RPC 변경 없음.
