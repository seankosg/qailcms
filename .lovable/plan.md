## 원인

DOM을 조사한 결과, ABD Raw Data 테이블에 컬럼이 37개가 아니라 39개가 렌더링되고 있습니다. `sl_no`, `abd_number`가 헤더에 두 번씩 등장합니다.

로컬 저장된 뷰 프리퍼런스에서 `frozenExtras: ["plot", "sl_no", "abd_number"]` 처럼 사용자 핀 목록에 이미 시스템 고정 컬럼(`SYSTEM_FROZEN_IDS = ["sl_no", "abd_number"]`)이 포함되어 있는데, `AbdRawDataPage`의 `orderedKeys`가 다음과 같이 계산됩니다:

```
[...SYSTEM_FROZEN_IDS, ...frozenExtras, ...rest]
```

`rest`는 SYSTEM/frozen을 걸러내지만 `frozenExtras` 자체는 그대로 프리펜드되므로 `sl_no`, `abd_number`가 두 번씩 붙어 총 39개가 됩니다.

이어서 `stickyLefts` 맵은 컬럼 ID를 키로 하므로 나중에 나타난 중복 항목이 앞선 좌표를 덮어씁니다. 그 결과 첫 번째 sl_no/abd_number 셀도 `left: 400px` / `470px`로 sticky되어, 원래 있어야 할 0~330px 영역이 완전히 비게 됩니다. 사용자가 본 "맨 왼쪽의 헤더/값 없는 빈 컬럼"의 실체입니다.

## 수정 범위

### 1. `src/components/abd/raw-data/AbdRawDataPage.tsx`

- `orderedKeys` 계산 시 `frozenExtras`에서 `SYSTEM_FROZEN_IDS`를 제거해 중복 방지.
  ```
  const frozenExtrasClean = frozenExtras.filter(k => !SYSTEM_FROZEN_IDS.includes(k));
  const rest = order.filter(k => !new Set(frozenExtrasClean).has(k) && !SYSTEM_FROZEN_IDS.includes(k));
  return [...SYSTEM_FROZEN_IDS, ...frozenExtrasClean, ...rest];
  ```
- 뷰 프리퍼런스 복원 시(`useEffect` 안 `baseFrozen`) `SYSTEM_FROZEN_IDS` 항목을 걸러 저장 상태도 자연 치유되도록 처리.
- `setFrozenExtras` 호출 시(즉 `AbdColumnOrderMenu`의 `onFrozenChange`) 시스템 고정 키를 사전에 제거하는 래퍼로 감쌈.

### 2. `src/components/abd/raw-data/AbdColumnOrderMenu.tsx`

- `toggleFrozen`에서 `SYSTEM_FROZEN_IDS`(또는 상위에서 내려주는 금지 키 목록)에 해당하는 키는 추가 자체를 금지 — 이미 시스템에 의해 고정되어 있으므로 pin 버튼을 눌러도 무시.
- 화면상 시스템 고정 컬럼(`sl_no`, `abd_number`)은 "Frozen · Select (고정)" 섹션에 항상 표시되고 pin/unpin 버튼은 노출되지 않도록 정리(이미 사용자가 실수로 넣은 항목을 자연 제거).

### 3. Snag(Defect) Raw Data 동일 패턴 점검

같은 로직이 `DefectRawDataPage`에도 있는지 확인해 동일 버그가 재현되지 않도록 필요 시 같은 방어 로직을 적용. 원본 정책과 동일 방향으로 유지.

## 검증

- 저장된 프리퍼런스에 `frozenExtras: ["plot","sl_no","abd_number"]` 상태에서 페이지 진입 시 헤더 컬럼 수가 37개가 되는지 DOM 확인.
- 맨 왼쪽 sticky 컬럼이 `sl_no`(width 70) → `abd_number`(width 260) 순서로 정상 렌더되고, 사용자 pin(`plot`)은 그 다음 sticky로 붙는지 확인.
- 스크롤 시 빈 영역 없이 프리즌 컬럼이 컨테이너 좌측에 붙는지 확인.
- Columns 메뉴에서 시스템 고정 컬럼은 unpin/제거되지 않는지, 일반 pin/unpin은 정상 동작하는지 확인.
