## SM Raw Data Refresh 버튼 폐기

### 변경 사항
- `src/components/defect-management/raw-data/DefectRawDataPage.tsx`
  - 상단 툴바의 Refresh 버튼(라인 818 부근) 제거.
  - 더 이상 사용되지 않으면 `RefreshCcw` import 및 관련 `isFetching` 표시용 참조 정리.
- AI 하자 분류 버튼은 **유지**(관리자 전용, 레거시 데이터 사후 보정용).

### 대체 갱신 수단
- Bulk Edit·임포트·인라인 편집 후에는 이미 React Query `invalidate`로 자동 갱신되므로 수동 Refresh 없이 최신 상태 유지됨.
- 필요 시 브라우저 새로고침 또는 필터 재적용으로 강제 재조회 가능.

### 검증
- 빌드 성공 및 SM Raw Data 툴바에서 Refresh 버튼이 사라졌는지 확인.