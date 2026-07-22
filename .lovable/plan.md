## 목표
SM·TM(및 이 컴포넌트를 쓰는 모든 페이지)의 Data Date 선택기를 "데이터가 있는 날짜만 선택 가능"에서 "모든 날짜 선택 가능"으로 변경. 데이터 유무와 무관하게 캘린더에서 자유롭게 선택.

## 변경 파일
- `src/components/task-management/shared/DataDatePicker.tsx` (단일 수정)

## 수정 내용
`DataDatePicker` 컴포넌트에서 아래 항목 제거/완화:
- `<Calendar>`의 `disabled={(date) => !allowed.has(...)}` 제거 (모든 날짜 활성).
- `fromDate` / `toDate` 제한 제거 (또는 넉넉히 열어둠) — 과거·미래 임의 선택 허용.
- `onSelect` 안의 `if (!allowed.has(key)) return;` 가드 제거.
- `allowed`/`minDate`/`maxDate` 관련 로직 정리 (필요한 `selectedDate`, `defaultMonth`만 유지). `options`, `latest`는 여전히 prop으로 받지만 선택 제한이 아닌 `defaultMonth` 초기값 참고용으로만 사용.

## 유지
- Props 시그니처(호출부 4개 파일 무변경), "최신" 뱃지, 초기화 버튼, 트리거 라벨 포맷.
- SM Dashboard/Progress, TM Task Tree/Raw Data 호출부는 그대로 동작.

## 영향
- 상위 훅(`useDefectLatestDataDate` 등)이 반환하는 `options`는 UI 표시에만 영향 없음. 데이터가 없는 날짜를 선택하면 기존 쿼리 로직대로 빈 결과가 나올 수 있음 — 사용자가 명시적으로 허용.
