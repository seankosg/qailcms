## 요구

ABD Raw Data에서 `sl_no`, `abd_number`를 시스템으로 강제 고정하지 않고, 다른 컬럼과 동일하게 사용자가 pin/unpin 할 수 있게 한다.

## 수정 범위

### 1. `src/components/abd/raw-data/AbdRawDataPage.tsx`

- `SYSTEM_FROZEN_IDS = ["sl_no", "abd_number"]` → `SYSTEM_FROZEN_IDS = []` (또는 상수 제거하고 관련 참조 모두 `[]`로 대체).
- `orderedKeys`: 시스템 프리펜드 없이 `frozenExtras` + 나머지로만 구성.
  ```
  const frozenSet = new Set(frozenExtras);
  const rest = order.filter(k => !frozenSet.has(k));
  return [...frozenExtras, ...rest];
  ```
- `columnVisibility` 계산에서 "SYSTEM_FROZEN이면 강제 true" 로직 제거. 일반 컬럼과 동일하게 `visibility` 상태를 그대로 반영.
- `AbdRawTableView`에 넘기는 `frozenColIds` → `frozenExtras` 만 사용.
- 뷰 프리퍼런스 복원 시 `baseFrozen`에서 SYSTEM 필터 제거(방어 로직 삭제 or 무해).
- `AbdColumnOrderMenu` 호출부의 `systemFrozen` 프롭 제거, `onFrozenChange`도 그대로 `setFrozenExtras`.

### 2. `src/components/abd/raw-data/AbdColumnOrderMenu.tsx`

- `systemFrozen` 프롭과 관련 렌더 분기(시스템 pin 표시, `toggleFrozen` 시스템 차단)를 제거. `sl_no`, `abd_number`도 다른 컬럼처럼 Columns 목록에서 pin/unpin 가능.

### 3. 기본값(defaultOrder / defaultVisibility) 유지

- 처음 진입 사용자에게 여전히 sl_no/abd_number를 왼쪽에 고정된 상태로 보여주려면 `abd_field_config`의 `sort_order`가 이미 낮게 설정되어 있어 컬럼 순서상 앞쪽에 위치. 사용자가 원하면 언제든 pin해서 sticky 고정 가능.
- 기존 사용자의 저장된 `frozenExtras`에 이미 이 두 키가 들어 있으면 그대로 사용자 pin으로 취급되어 동작.

## 검증

- 페이지 진입 시 헤더 컬럼 수가 정확히 ABD_COLUMNS 길이(37)와 일치.
- Columns 메뉴에서 `sl_no`, `abd_number`가 일반 컬럼 목록에 pin 버튼과 함께 나타남.
- 아무 것도 pin하지 않은 상태에서 좌측 sticky 컬럼이 없고 모든 컬럼이 함께 가로 스크롤됨.
- `sl_no`를 pin 하면 좌측에 sticky 고정되고, unpin 하면 해제됨(다른 컬럼과 동일 동작).
- 체크박스 해제로 `sl_no`/`abd_number` 노출도 자유롭게 제어 가능.
