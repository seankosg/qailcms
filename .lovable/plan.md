## Room Group 카드 헤더 수정 — "처리 필요" 지표로 변경

### 대상 파일
`src/components/defect-management/dashboard/DeSnagRoomGroupCards.tsx` (해당 파일만)

### 변경 내용

**현재 헤더:**
- 좌측: Room Group 이름
- 우측: 총 Issued 수 (예: `1,234`)
- 서브 라벨: "Issued (그룹 총계)"

**변경 후 헤더:**
- 좌측: Room Group 이름 (유지)
- 우측: **처리 필요 개수 + %** — 붉은색(`text-red-600 dark:text-red-500`, `font-bold tabular-nums`)으로 강조
  - 값 = `open + reopen`
  - % = `(open + reopen) / issued * 100` (issued=0이면 `—`)
  - 표기: `456  ·  37%` (한 줄, 큰 숫자 + 옆에 작은 %) — 기존 큰 숫자 스타일 유지
- 서브 라벨: "처리 필요 (Open + Re-Opened)" 로 문구 변경, 우측 정렬. 참고용으로 `/ Issued 1,234` 를 회색 작은 글씨로 병기 (분모 컨텍스트 제공)

### 유지되는 요소
- 스택 바 차트 (직전 계획대로 구현된 것) 그대로 유지
- 하단 status별 카운트·% 범례 유지
- 카드 클릭 시 `room_group` 필터로 Raw Data 이동 동작 유지

### 스코프 외
- Grand Total 카드, Matrix, 필터바, 데이터 파이프라인 변경 없음
- `DeSnagDashboardPage.tsx` 변경 없음

### 검증
- `bunx tsgo --noEmit` 타입 통과
- Playwright 스크린샷으로 헤더 붉은색 숫자·% 표시 및 issued=0 케이스(`—`) 확인
