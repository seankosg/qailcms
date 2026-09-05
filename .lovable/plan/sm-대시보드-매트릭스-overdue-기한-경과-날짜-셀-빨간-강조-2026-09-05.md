# SM 대시보드 매트릭스 — Overdue(기한 경과) 날짜 셀 빨간 강조

## 배경
Each Date 모드의 날짜는 `planned MAX` 날짜(ISO `yyyy-mm-dd`)다. 스테이지가 미완료(잔여 > 0)인데 그 계획일이 이미 지났으면 사실상 지연 상태지만, 현재는 일반 텍스트로만 보여 지연을 놓치기 쉽다.

## 판정 규칙 (Overdue)
한 셀이 다음 두 조건을 모두 만족하면 Overdue로 표시한다.

1. **미완료**: 해당 스테이지·팀의 잔여 > 0 (`issued - done > 0`) — 이미 화면 로직에 있는 `stageDone === false`와 동일 조건
2. **기한 경과**: 표시 중인 계획일(planned MAX, ISO 문자열) < 오늘(도하 기준, Asia/Qatar)

- 완료된 셀(실적일 표시, 회색 반전)은 Overdue 대상 아님 — 기존 회색 유지
- 계획일이 없는 셀(–)은 판정 불가이므로 제외
- 날짜 비교는 ISO 문자열 사전식 비교로 충분(기존 maxInto와 동일 원리). 오늘 날짜는 기존 `dohaDateTime`/도하 유틸을 사용해 앱 표준시 정책과 일치시킨다.

## 표시 스타일
- Overdue 셀: **빨간 배경(`bg-destructive/25` 수준의 붉은 틴트) + 굵은 진한 텍스트**로 표시해 숫자 셀/완료 셀과 명확히 구분
- 기존 병목(빨간 틴트) 하이라이트보다 진하게 하거나, 병목과 겹칠 경우 Overdue가 우선
- 툴팁에 `· 지연(계획일 경과)` 문구 추가 → MEP 지연 발견 시 소통 근거로 활용

## 적용 범위 (화면)
`DeSnagMatrixBlock.tsx`의 `TeamCells` 날짜 렌더링 경로:
- **Each Date 모드**(날짜 대체) — 메인 대상
- **잔여+Date 모드**(dual)의 Date 열 — 동일 판정을 동일하게 적용(사용자 확인 필요 시 Each Date만으로 한정 가능)

## 적용 범위 (엑셀)
`matrix-excel.ts`의 날짜 셀(eachDate/dual 경로)에도 동일 판정을 적용해, Overdue 셀을 붉은 배경/붉은 글씨 스타일로보낸다. 화면과 다운로드 결과가 일치해야 한다는 기존 원칙 유지.

## 수정 파일
1. `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx` — Overdue 판정 + 셀 스타일/툴팁
2. `src/lib/defect-management/matrix-excel.ts` — 동일 판정의 엑셀 스타일

## 검증
- `bunx tsgo --noEmit` 통과
- Playwright로 Each Date 모드에서 잔여>0 & 계획일 경과 셀이 빨갛게 표시되는지, 완료 셀(실적일)은 회색 유지인지 스크린샷 확인
- 엑셀 다운로드 후 날짜 셀 스타일 대조

## 변경하지 않는 것
- 매트릭스 열 구조, 토글, 필터, RPC, 집계 로직 — 모두 그대로
- 숫자 셀(개수/%/잔여) 스타일, 병목·Ready 하이라이트 규칙 — 그대로(Overdue는 날짜 셀 전용)
