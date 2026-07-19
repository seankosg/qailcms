## 목표

Task Summary(TaskTreePage.tsx) 상단 툴바 개편:
1. 팀(discipline) 탭 옆에 **HDEC PIC 필터** 풀다운 추가 (팀 선택과 연동)
2. **지연만** 단일 토글을 **All 지연 / Main Task 지연 / Sub Task 지연** 3-옵션 선택으로 확장하고 검색창 **왼쪽**으로 이동

## 변경 파일
`src/components/task-management/tree/TaskTreePage.tsx` (단일 파일 편집)

### 1. HDEC PIC 필터 (풀다운)

- 상태: `const [picFilter, setPicFilter] = useState<string>("__all__")`
- 옵션 소스: 현재 로드된 `data`에서 `hdec_pic_name` 값을 수집 → 유니크 정렬. 팀 전환 시 데이터가 바뀌므로 팀별로 자연스럽게 옵션이 재구성됨(팀 필터와 연동됨).
  - 빈 값(없음) 항목이 존재할 경우 `"(미지정)"` 옵션 추가
- UI: `Select` (shadcn) 컴포넌트, 트리거 폭 `w-40`, 위치는 팀 Tabs 바로 오른쪽
  - 옵션: `모든 HDEC PIC` (기본), 각 PIC 이름들, `(미지정)`
- 필터 적용 위치: `filtered` 계산 로직에 다음 규칙 추가
  - `__all__`이면 통과
  - `__unassigned__`이면 Main 및 자식 중 `hdec_pic_name`이 비어 있는 항목이 하나라도 있으면 통과
  - 특정 이름이면 Main 또는 자식 중 하나라도 그 이름과 일치하면 통과 (Main만 매칭 시에도 하위 전체 표시, Sub만 매칭 시에도 부모 카드 노출)
  - 팀 재선택 시 `useEffect`로 현재 옵션 리스트에 `picFilter` 값이 없어지면 자동으로 `__all__` 리셋

### 2. 지연 필터 3-옵션화 및 좌측 이동

- 상태 변경: `behindOnly: boolean` → `delayFilter: "off" | "all" | "main" | "sub"` (기본 `"off"`)
- UI: `Select` (shadcn) 풀다운으로 렌더, 옵션 라벨
  - `지연 필터 없음` (off)
  - `All 지연` (all)
  - `Main Task 지연` (main)
  - `Sub Task 지연` (sub)
- 위치 이동: 기존 툴바 우측 그룹(`ml-auto flex ...`) 안에서 **검색 Input의 왼쪽**에 배치. 즉 순서는:
  - `[지연 필터 Select] → [검색 Input] → [펴기] → [접기]`
- 필터 로직 (`filtered` 계산):
  - `off`: 스킵
  - `all`: Main 또는 자식 중 하나라도 `todayGap < -0.05`이면 통과 (현재 `anyBehind`와 동일)
  - `main`: Main 자체(`p`)가 `todayGap < -0.05`일 때만 통과
  - `sub`: 자식 중 하나라도 `todayGap < -0.05`일 때만 통과 (Main만 지연이고 자식은 정상이면 제외)

### 3. 헤더 정렬

- 툴바가 길어질 수 있으므로 감싸는 `flex flex-wrap items-center gap-2`는 유지. 우측 그룹 내부에도 `flex-wrap`이 이미 적용되어 있어 별도 반응형 조정 불필요.

## 영향 없음

- 데이터 쿼리(`task-tree` queryKey), DB 스키마, RPC, 트리 렌더링, 이력 드로어, 다른 페이지 미변경.
- 검색 문자열 로직, 판정/차이 계산 로직 유지.
