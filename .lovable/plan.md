대시보드의 카드 영역에서 status 순서를 현재 `Open → Rectified → Re-Opened → Closed`에서 `Open → Re-Opened → Rectified → Closed`로 변경합니다.

## 변경 대상
1. `src/components/defect-management/dashboard/DeSnagGrandTotalCards.tsx`
   - Grand Total KPI 카드의 렌더링 순서를 조정
   - 기존: Issued → Open → Rectified → Re-Opened → Closed
   - 변경: Issued → Open → Re-Opened → Rectified → Closed
2. `src/components/defect-management/dashboard/DeSnagRoomGroupCards.tsx`
   - Room Group 카드 내부의 StackedBar 세그먼트 및 Legend 범례 순서 조정
   - `SLOT_ORDER`을 `open → reopen → rectified → closed`로 변경

## 변경하지 않는 것
- 데이터 계산, 색상, 라벨 텍스트, 클릭 시 이동 로직 등은 그대로 유지
- MatrixBlock 테이블 영역은 "카드"가 아니므로 본 지시 범위에서 제외(별도 요청 시 처리)

## 검증
- `bunx tsgo --noEmit`로 타입 체크
- 변경 후 대시보드 미리보기에서 Open 카드 바로 다음에 Re-Opened 카드가 표시되는지 확인