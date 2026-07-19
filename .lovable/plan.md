SM 및 ABD Progress S-curve의 variance 막대 음수 색상이 검정으로 fallback 되는 문제 수정

## 현재 상태
- `AbdPlanVsActualCard.tsx` (line 300-310)와 `SnagPlanVsActualCard.tsx` (line 272-282)에서 variance 막대의 fill을 `hsl(var(--destructive))`로 지정.
- `--destructive` CSS 변수는 `oklch(...)` 값이므로, `hsl(var(--destructive))`는 유효하지 않은 CSS 색상 표현이 됨. 브라우저는 이를 파싱 실패로 처리하여 검정색으로 fallback 할 수 있음.
- 양수(초록)도 `hsl(160 60% 45%)` 고정값으로 지정되어 있어 디자인 시스템과 약간 어긋남.

## 수정 내용
1. 두 컴포넌트의 variance 막대 fill을 `hsl(var(--destructive))`에서 `var(--destructive)` 또는 `var(--color-destructive)`로 변경하여 oklch 값이 직접 전달되도록 함.
2. 양수 fill도 `hsl(160 60% 45%)` 고정값에서 `var(--color-emerald-600)` 또는 디자인 시스템의 초록 토큰으로 일원화.
3. KPI 텍스트 색상(`text-destructive`, `text-emerald-600`)은 Tailwind가 CSS 변수를 제대로 해석하므로 그대로 유지.
4. 수정 후 `/closure/abd/progress`와 `/closure/snag-management/progress`에서 variance 막대의 음수/양수 색상이 의도한 빨강/초록으로 표시되는지 확인.

## 영향 파일
- src/components/abd/progress/AbdPlanVsActualCard.tsx
- src/components/defect-management/progress/SnagPlanVsActualCard.tsx
- src/styles.css (필요 시 emerald 토큰 추가/확인)