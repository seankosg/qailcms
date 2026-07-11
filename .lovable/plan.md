## 에러 원인
Import 배치 upsert에서 `21000: ON CONFLICT DO UPDATE command cannot affect row a second time` 발생.
→ 동일 배치 안에 **`(discipline, task_no)` 중복 행**이 존재. hint에 `AC-T-01` 노출된 것으로 보아 엑셀에 같은 task_no가 여러 번 등장.

## 대응 계획

### 1) Import 사전 중복 검증 & 자동 dedupe (`TaskManagementImportContext.tsx`)
- 파싱 직후 `task_no` 기준으로 그룹화해 중복 검출
- 파일 카드에 `중복 task_no: N건 (예: AC-T-01 x3)` 경고 표시
- upsert 직전 dedupe 정책:
  - **기본**: 같은 task_no 중 마지막 행(sort_order 큰 것) 채택, 나머지는 warnings에 기록
  - parent+child 혼재 시 child 우선 (parent는 어차피 rollup으로 재계산)
- 결과 카드에 `Duplicates skipped: N` 카운트 추가

### 2) 파서 원인 규명 (`src/lib/task-management/parser.ts`)
- 업로드하신 `20260710_Task_Management_건축-3.xlsx`를 파서에 태워 실제 어떤 task_no가 중복 생성되는지 로그로 확인
- 헤더/병합셀 처리 버그면 파서 수정 (근본 원인)

### 3) 거절 행 UI 개선 (선택)
- 화면에 이미 있는 "거절 행 에러 보기", "거절 행 엑셀 내보내기" 버튼을 실제 동작하도록 배선 (현재 placeholder면)
- 중복행/거절행을 xlsx로 다운로드 가능하게

### 4) DB 방어 (선택, 스코프 밖일 수도)
- `task_management_raw`에 UNIQUE(discipline, task_no) 제약이 이미 있는 상태에서, dedupe는 어플리케이션 레이어에서 처리하는게 맞음. DB 변경 없음.

## 구현 순서
1. 업로드 파일을 파서에 돌려 어떤 task_no가 중복되는지 확인 → 근본원인이 엑셀인지 파서인지 판별
2. 판별 결과에 따라:
   - 엑셀 원본 문제면 → dedupe 로직 + 경고 UI만 추가
   - 파서 문제면 → 파서 수정 우선, dedupe는 안전망으로 유지
3. Import 컨텍스트에 dedupe/경고 통합

## 파일 변경 (예상)
- 수정: `src/lib/task-management/parser.ts` (필요 시), `src/contexts/TaskManagementImportContext.tsx`, `src/components/task-management/import/TaskManagementImportPage.tsx`
- 신설: 없음

## 범위 밖
- DB 스키마 변경, 새 테이블
