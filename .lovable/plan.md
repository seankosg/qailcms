# 대시보드 재계산 방식 개선 계획

## 추천 방식

**안 2: 스테이지 필터 + '재계산' 적용 버튼 (Plot/Team 위주)**

사용자가 질문하신 "재계산 버튼을 별도로 만들고, 그 외에는 최초 진입 시만 재계산" 요구를 가장 직접적으로 만족합니다. 다만 데이터 특성상 Room Group은 이미 클라이언트에서만 필터링되므로, 즉시 반영을 유지하고 **Plot/Team만 스테이징**하는 것이 사용성/부하 절감의 균형이 좋습니다.

## 현재 상태

- `src/hooks/useSnagDashboardMatrix.ts`는 `plot` + `teams`를 queryKey로 삼아 Supabase RPC `defect_snag_dashboard_matrix`를 호출합니다.
- `DeSnagDashboardPage.tsx`는 `Route.useSearch()`에서 `plot`, `teams`, `roomGroups`를 읽어 툴바/탭/필터바에 연결합니다.
- Plot 탭이나 Team 토글을 누를 때마다 `navigate`로 URL/search를 바꾸고, 그로 인해 queryKey가 바뀌어 서버 재호출이 발생합니다.
- Room Group 필터는 `filteredRows`에서 클라이언트만 필터링하므로 서버 재호출은 없습니다.
- DB 전체 active 행은 11만 건이지만, `GROUP BY` 결과는 전체 Plot/Team 기준 약 2,036행으로 매우 작습니다.

## 구현 내용

1. **스테이징 상태 추가**
   - `DeSnagDashboardPage`에 `stagedPlot`, `stagedTeams`, `stagedRoomGroups` (또는 Plot/Team만) state를 추가합니다.
   - 초기값은 URL search에서 파생되어, 공유 URL로 진입 시 필터가 그대로 유지됩니다.

2. **컨트롤 연결 변경**
   - Plot `Tabs`, `DeSnagToolbar`는 `staged*` 값을 읽고 `setStaged*`로만 변경합니다.
   - `DeSnagRoomGroupFilterBar`는 두 가지 중 선택:
     - **A) Plot/Team만 스테이징**: Room Group은 기존처럼 URL에 즉시 반영, 즉시 필터링.
     - **B) 전체 스테이징**: Room Group도 `stagedRoomGroups`에만 반영하고, 재계산 버튼 때 일괄 적용.
     - **추천: A**. Room Group은 서버 호출이 없으므로 스테이징의 이득이 없고 오히려 UX를 해칩니다.

3. **'재계산' 버튼 추가**
   - 상단 툴바 영역에 `적용 / 재계산` 버튼을 배치합니다.
   - 클릭 시 `navigate({ search: { plot: stagedPlot, teams: ..., roomGroups: ... } })`로 URL을 업데이트합니다.
   - URL이 변경되면 `useSnagDashboardMatrix`가 새 queryKey로 서버 RPC를 호출합니다.

4. **'초기화' 버튼**
   - 스테이징 값을 현재 URL 값으로 되돌리거나, 기본값(Plot C, 전체 Team, 전체 Room Group)으로 초기화합니다.

5. **시각적 피드백**
   - 스테이징 값이 URL 적용 값과 다를 경우, 재계산 버튼을 강조하거나 배지로 "필터 변경됨" 표시를 추가합니다.
   - 적용 중에는 `isLoading` UI가 그대로 노출됩니다.

## 변경 파일

- `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx` (주요 변경)
- `src/components/defect-management/dashboard/DeSnagToolbar.tsx` (변경 없음, 그대로 사용)
- `src/components/defect-management/dashboard/DeSnagRoomGroupFilterBar.tsx` (변경 없음, 그대로 사용)

## 검증 항목

- Plot 탭/Team 토글 변경 시 서버 호출이 발생하지 않음.
- '재계산' 버튼 클릭 시에만 서버 RPC 호출 및 매트릭스 재계산.
- 공유 URL로 진입 시 최초 1회 자동 계산.
- Room Group 필터는 즉시 반영 (또는 선택 시 스테이징 후 일괄 적용).
- `bunx tsgo --noEmit` 통과.

## 장단점

- **장점**: 사용자 요청과 정확히 일치; 실수로 필터를 바꿀 때 서버/DB 부하를 방지; 적용 후 URL 공유 가능.
- **단점**: Plot/Team 변경 후 즉시 반영되지 않고 추가 클릭 필요; 미적용 상태는 URL에 반영되지 않음.

## 대안

- **안 1 (전체 데이터 1회 로드 + 클라이언트 필터링)**도 현재 데이터 크기(2,036행)에서는 더 쾌적하고 구현이 간단합니다. 재계산 버튼은 없지만, 브라우저 새로고침으로 갱신합니다. 대안으로 고려 가능합니다.

## 다음 단계

- 위 방식(A: Plot/Team만 스테이징)으로 승인되면 구현을 시작합니다. Room Group까지 스테이징하고 싶다면 별도로 말씀해 주세요.