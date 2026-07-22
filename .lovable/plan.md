## 변경 요약

`DeSnagDashboardPage.tsx` 한 파일 수정으로 세 가지 요구사항을 처리합니다.

### 1) 라벨 변경
- L168 `<h1>` 문구: `De-Snagging Dashboard` → **`Snagging List Dashboard`**
- 사이드바 라벨/파일명/라우트 경로는 손대지 않습니다 (요청 범위는 헤더 라벨 한 곳). 필요 시 별도 지시 부탁드립니다.

### 2) 팀 필터를 Plot 탭 옆으로 이동
- 현재 헤더 블록(L165–196) 우측에 있는 `<DeSnagToolbar>` (팀 다중선택 pill)를 제거.
- Plot 탭 줄(L198–218)로 이동해 Tabs 오른쪽, 재계산/초기화 버튼 왼쪽에 배치.
- 헤더 우측이 비어 시각적으로 허전해지므로 헤더는 `justify-start`로 정리하고 제목·Data Date만 남깁니다.

레이아웃 후 결과:

```text
[ Snagging List Dashboard   |  DataDatePicker ]
     (설명 문구)

[ Plot C  Plot D ] [ 팀 pills ]        [ '변경됨' 뱃지  재계산  초기화 ]
[ Room Group 필터바 ]
[ KPI 카드들 · 매트릭스 … ]
```

- 반응형: `flex-wrap` 유지. 좁은 화면에서는 팀 pills 가 다음 줄로 넘어갑니다.
- `DeSnagToolbar` 컴포넌트 자체는 그대로 재사용(내부 라벨/props 미변경).

## 3) "자동 재계산" 도입 시 문제점 분석

현재는 Plot/Team 변경을 로컬 state로 스테이징하고 **재계산 버튼**으로만 URL 변경 → `useSnagDashboardMatrix` RPC 재호출이 일어납니다. 이를 자동 재계산(변경 즉시 URL 반영)으로 바꿀 경우 예상 리스크는 다음과 같습니다.

### 3-A. 서버·네트워크 부하
- 팀 pill은 다중 선택이라 사용자는 대개 여러 개를 순차 토글합니다. 자동 재계산이면 4팀 토글 시 **4번의 RPC**가 발생 → 각 호출이 `defect_items_raw`에서 수천~수만 행을 스캔합니다.
- Plot 전환은 매트릭스 전체를 새로 만들기 때문에 비용이 더 크며, 잘못 눌러도 즉시 무거운 쿼리가 나갑니다.

### 3-B. UX 저하
- 로딩 스켈레톤/`불러오는 중…` 표시가 토글마다 깜빡거림.
- 늦게 도착한 이전 요청 결과가 새 결과 위에 덮이는 **race 가능성** (React Query가 대체로 방어하지만 `keepPreviousData` 없이 쓰면 flicker 확실).
- 원치 않던 조합(예: 팀 3개를 순차로 켜는 도중의 중간 상태)도 그래프가 즉시 반응 → 인지 부하 증가.

### 3-C. URL/히스토리 오염
- 매 토글마다 `navigate({ search: ... })` 가 브라우저 히스토리에 새 항목을 push → 뒤로가기 여러 번 눌러야 이전 화면.
- 공유 링크 복사 시점이 애매해짐.

### 3-D. 의도치 않은 파생 효과
- Plot 변경은 헤더의 `plan_group`, Building/Level 축 자체가 바뀌므로 URL 즉시 반영 시 Room Group 필터/Raw Data 드릴다운 링크 파라미터도 함께 갈아치워야 합니다. 이 재-빌드가 렌더링 도중 발생하면 매트릭스 셀 클릭 시 이전 컨텍스트로 이동하는 버그 여지가 있음.

### 3-E. 마이그레이션 시 필요한 방어 조치 (자동화로 갈 때)
자동화로 바꾸려면 최소한 아래를 함께 넣어야 안전합니다.
1. **debounce**: staged 값이 300~500ms 안정된 뒤에만 URL 반영.
2. `navigate({ replace: true })`: 히스토리 스팸 방지.
3. React Query 옵션 `placeholderData: keepPreviousData` (또는 `keepPreviousData: true`) 적용해 flicker 억제.
4. Plot 변경은 즉시 반영하되 Team pill 토글은 debounce 대상으로만 두는 하이브리드도 검토 가능.
5. `useSnagDashboardMatrix` 쿼리 키가 `plot,teams,dataDate` 순서 정렬 기반인지 확인 (팀 순서만 달라도 캐시 miss 나면 재요청 발생).

### 권장
이번 커밋에서는 라벨·레이아웃만 반영하고 **재계산 버튼은 그대로 유지**. 자동 재계산은 위 5개 방어책과 함께 별도 커밋으로 진행하시는 것을 권장드립니다. 원하시면 바로 자동 재계산까지 이번 계획에 포함하겠습니다.

## 확인 요청
- 라벨 변경 범위: h1 텍스트만 (사이드바/라우트 미변경) — 맞으시죠?
- 자동 재계산 도입은 이번 계획에 **포함할까요, 이후 별도 진행할까요?**

승인 주시면 build 모드에서 파일 1개(`DeSnagDashboardPage.tsx`) 수정 → 타입체크 순서로 진행합니다.