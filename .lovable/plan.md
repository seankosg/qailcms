# Defect Import 페이지 이탈 시에도 임포트 지속

## 문제
현재 `DefectManagementImportProvider`는 `DefectManagementImportPage` 컴포넌트 내부(`src/components/defect-management/import/DefectManagementImportPage.tsx:67`)에 마운트되어 있습니다. 다른 라우트로 이동하면 페이지가 언마운트되고 Provider와 그 안의 `executeImport` async 루프가 파괴되면서 진행 중이던 배치 업서트/상태 업데이트가 중단되고 `files` 상태도 모두 사라집니다.

## 해결 방향
Provider를 루트로 승격해 라우트 전환과 무관하게 살아있게 만들고, 페이지는 그 Provider의 상태를 소비만 하도록 변경합니다.

## 변경 사항

### 1. `src/routes/__root.tsx`
- `DefectManagementImportProvider`를 임포트하여 `<TooltipProvider>` 안쪽, `<Outlet />`을 감싸도록 배치.
- 위치: `QueryClientProvider` → `TooltipProvider` → `DefectManagementImportProvider` → `Outlet`.
- 이렇게 하면 `useQueryClient()`, Supabase 클라이언트 접근은 유지되며 앱 전 라이프타임 동안 단 하나의 인스턴스가 유지됨.

### 2. `src/components/defect-management/import/DefectManagementImportPage.tsx`
- `DefectManagementImportPage`에서 `<DefectManagementImportProvider>` 래퍼 제거. `Inner`만 렌더링.
- `DefectManagementImportProvider` import 제거 (`useDefectImport` 등 나머지 유지).

### 3. `src/contexts/DefectManagementImportContext.tsx`
- `executeImport`의 `useCallback` deps 배열이 `[]`로 비어있어 최신 `qc`를 캡처하지 못하는 경미한 이슈만 정리 (`[qc]` 추가). 나머지 로직은 그대로 유지.
- 파일이 언마운트되어도 실행이 지속되도록 하는 별도 로직은 불필요 — Provider가 살아있으면 `setFiles` 콜백/`await` 체인이 그대로 진행됨.
- 페이지 진입 시 이전 실행 결과(`done`/`failed` 파일)가 남아있을 수 있으므로 UX 변화는 최소한만: 사용자가 명시적으로 `clearAll`/`removeFile`을 눌러야 정리됨(기존 동작 유지).

## 검증
- `bunx tsgo --noEmit`으로 타입 확인.
- 실사용 시나리오: 임포트 시작 → 다른 라우트로 이동 → 잠시 후 `/closure/defect-management/import` 재진입 → 파일 카드가 progress를 계속 갱신하며 `done`으로 전환되는지 확인. `toast.success` 알림도 페이지 밖에서 표시되는지 확인.

## 비고 / 스코프 밖
- 새로고침(전체 페이지 리로드)이나 탭 종료 시 지속은 이번 스코프 아님(BroadcastChannel/Service Worker/서버 이관 필요). 이번 변경은 "라우트 전환 중 지속"에 한정.
- 페이지 이탈 시 진행 중임을 알리는 `beforeunload` 경고도 이번 스코프 밖(요청 없음).
