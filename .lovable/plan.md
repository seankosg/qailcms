# Defect Raw Data — Columns 버튼 추가 (컬럼 순서/보이기·숨기기/좌측 고정)

Task Raw Data 상단의 `Columns` 팝오버(`ColumnOrderMenu`)와 동일한 UX·데이터 저장 방식을 Defect Raw Data 페이지에 이식합니다. 사용자 pin/unpin과 서버 저장 포함.

---

## 1. 목표 UX (Task 페이지와 완전 동일)

- 툴바(Export 근처)에 **Columns** 버튼 → 팝오버.
- 팝오버 내부:
  - **Frozen 섹션**
    - 시스템 고정 3열(`__select`, `is_critical`, `stage_progress`)은 표시만, unpin 불가.
    - 사용자 pin 3열까지 추가 가능(총 좌측 고정 = 시스템 3 + 사용자 3, 최대 6). Task는 시스템 2(`__select`, `task_no`) + 사용자 3인데, Defect는 시스템 3 + 사용자 3.
  - **Columns 섹션**: 나머지 컬럼 드래그 순서 변경, 체크박스 표시/숨김, pin 버튼으로 좌측 고정 토글(사용자 pin 개수 3/3 도달 시 비활성).
  - **Reset**: 순서·visibility·frozenExtras 초기화.

## 2. 상태 및 서버 저장

Task와 동일 구조를 채택:

- 상태(`useState`): `order: string[]`, `visibility: VisibilityState`, `frozenExtras: string[]`.
- 저장 훅: `useUserViewPreference("defect-management.raw-data.v1")` — Task와 같은 훅, 서버(user_view_preferences 테이블) + 로컬 캐시 자동 동기화.
- 기존 `localStorage` 저장(`sorting/columnFilters/columnSizing/globalFilter`)도 **함께 view preference로 이관**하여 단일 소스로 통일 (Task 페이지가 이렇게 함). 마이그레이션: 훅 최초 로드 시 서버 값이 없고 기존 localStorage 값이 있으면 그 값을 초기 seed로 사용 후 훅으로 저장.
- 저장 payload 스키마(`DefectPersistedState`):
  ```
  {
    sorting, columnFilters, columnSizing, globalFilter,   // 기존 localStorage에서 이관
    order, visibility, frozenExtras                        // 신규
  }
  ```
- 유효성 검증: 로드 시 현재 `DEFECT_COLUMNS`에 없는 key 제거, 새 key는 기본 순서 끝에 삽입, `frozenExtras`는 최대 3개로 clamp (Task의 merge 로직 이식).

## 3. 컬럼 파이프라인

현재: `columns = [selectCol, criticalCol, stageCol, ...DEFECT_COLUMNS]` — 정적 순서.

변경 후:

1. `DEFAULT_ORDER = DEFECT_COLUMNS.map(c => c.key).filter(k => k !== "is_critical")` — Critical은 시스템 frozen이므로 order 배열에서 제외.
2. `orderedKeys = ["__select", "is_critical", "stage_progress", ...frozenExtras, ...order.filter(k => !frozenExtras.includes(k))]`.
3. 컬럼 빌드: `orderedKeys`를 순회, id별로 기존 정의(selectCol/criticalCol/stageCol) 또는 `buildDataColumn`으로 생성.
4. `columnVisibility`: 시스템 3열 + 사용자 pin된 열은 항상 `true`, 나머지는 사용자 `visibility` 우선, 없으면 admin `fieldConfig.is_visible` 값 유지.

## 4. Sticky/Frozen 렌더링 변경

현재 `DefectRawTableView`는 `FROZEN = 3` 상수로 앞 3열만 sticky 처리. 사용자 pin을 지원하려면 Task와 같은 방식으로 리팩터:

- `FROZEN` 상수 제거. 대신 상위 페이지에서 `frozenColIds = ["__select", "is_critical", "stage_progress", ...frozenExtras]`를 계산해 `props`로 내려줌.
- `TableView`는 `frozenColIds` set을 받아, 리프 컬럼을 순회하며 해당 id면 sticky + `left` 오프셋을 누적 계산.
- `frozenWidth` / `stickyLefts` / 경계 그림자(`shadow-[2px_0_4px_-2px]`)를 프로즌 마지막 컬럼에만 적용하도록 조건 변경.
- `TopHorizontalScrollbar`에도 새 `frozenWidth` 전달.

## 5. Columns 팝오버 컴포넌트

- 신규: `src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx`
- Task의 `ColumnOrderMenu` 구조 그대로 이식. 차이점:
  - `TM_COLUMNS` → `DEFECT_COLUMNS`.
  - 라벨 리졸버: `useDefectFieldHelpers().getLabel(key)`.
  - Frozen 섹션 헤더: `Frozen · select/critical/progress (시스템) + 사용자 ({frozenExtras.length}/3)`.
  - 사용자 frozenExtras는 unpin 가능, 시스템 3개는 표시만 하고 unpin 버튼 없음.
  - pin 버튼: `frozenExtras.length >= 3`일 때 disabled.

## 6. 툴바 배치

`DefectRawDataPage.tsx` 상단 액션 영역, Export 버튼 왼쪽에 `<DefectColumnOrderMenu ... />` 삽입:

```
<DefectColumnOrderMenu
  order={order}
  visibility={visibility}
  frozenExtras={frozenExtras}
  onOrderChange={setOrder}
  onVisibilityChange={setVisibility}
  onFrozenChange={setFrozenExtras}
/>
```

## 7. 검증 체크리스트

- 팝오버 열림 → 드래그 순서 변경 → 테이블 재정렬.
- 체크박스로 감춤/표시.
- pin 버튼으로 사용자 컬럼 좌측 고정 → sticky 렌더링에 반영, 3/3 도달 시 비활성.
- unpin으로 원위치.
- Reset → 기본 순서 + 시스템 frozen만 남음.
- 새로고침 후 상태 복원 (서버 + 로컬 캐시).
- 다른 기기 로그인 시 서버 값으로 동기화.
- 기존 sorting/filter/sizing/URL drilldown 회귀 없음.
- 시스템 frozen 3개는 항상 왼쪽 유지, 그림자는 마지막 frozen 뒤에만.

## 8. 변경 파일

- 신규: `src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx`
- 수정: `src/components/defect-management/raw-data/DefectRawDataPage.tsx`
  - `order/visibility/frozenExtras` state 추가
  - `useUserViewPreference("defect-management.raw-data.v1")` 도입, 기존 localStorage 저장/복원 로직 이관 (기존 localStorage에서 최초 1회 seed 마이그레이션)
  - `columns` 빌드를 `orderedKeys` 기반으로 재구성
  - `columnVisibility` 계산에 사용자 값 반영
  - `DefectRawTableView`에 `frozenColIds` prop 전달, 하드코딩된 `FROZEN=3` 제거
  - 툴바에 팝오버 삽입

## 9. 비파괴 보장

- 서버 스키마 변경 없음(`user_view_preferences`는 Task에서 이미 사용 중, `view_key`만 다름).
- `DEFECT_COLUMNS`, admin `fieldConfig` 로직 그대로 유지 — 사용자 설정이 없을 때는 현행 동작과 동일.
