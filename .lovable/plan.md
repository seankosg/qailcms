먼저 사과드립니다. 이전 반영이 기대와 달랐던 이유는, 제가 25만행 성능 개선을 우선하면서 현재 프로젝트의 기존 Raw Data UI를 유지한 채 서버 페이지네이션·Unclosed/Closed 탭 구조로 재작성했기 때문입니다. 사용자의 지시는 @project의 UI/기능/데이터 흐름을 그대로 이식하라는 의미였으므로, 단순 성능 개선이 아니라 SHAW PROJECT CMS의 Defect Raw Data 기준으로 재정렬해야 합니다.

## 목표
현재 Defect Raw Data를 [SHAW PROJECT CMS](/projects/5e5a7b8e-c4af-4278-baec-3446e05cc4be)의 Defect Raw Data와 기능/화면 동작이 일치하도록 수정합니다. 단, 현재 데이터가 최대 25만행이므로 원본의 클라이언트 전량 캐시 방식은 그대로 복원하지 않고, 서버 페이지네이션/RPC 기반 성능 구조 위에서 동일한 사용 경험을 구현합니다.

## 반영 기준

### 1. 상단 UI를 SHAW 원본과 맞춤
- 제목을 `Defect Raw Data`로 변경
- 설명 문구를 원본과 동일한 톤으로 변경
- 현재 추가된 `Dashboard`, `Import Logs`, `Column Order Menu`, 팀 빠른 필터 카드, Unclosed/Closed 탭의 시각적 배치를 원본 기준으로 재조정
- 버튼 구성은 원본 기준으로 정렬
  - `Import`
  - `Export Excel`
  - `Export`
- 검색 영역을 원본처럼 구성
  - `Search defects... (comma = AND)`
  - 현재 필터 적용 record 수 표시
  - `Clear sort (n)` 버튼
  - `Shift+Click headers for multi-sort` 안내
  - Stage Progress Legend 표시

### 2. 필터/검색/정렬 동작을 원본과 맞춤
- 원본의 `Active URL filters` 영역 복원
  - dashboard drill-down에서 넘어온 URL 필터를 별도 칩으로 표시
  - 각 칩 개별 해제
  - `Clear all` 지원
- 원본의 `Active column filters` 영역 복원
  - 컬럼 필터 칩 별도 표시
  - 개별 해제 및 전체 해제
- 쉼표 검색은 원본처럼 AND 조건으로 처리
- Shift+Click multi-sort 지원
- 정렬 초기값은 원본의 Issue No 기준 정렬과 맞추되, 현재 DB 컬럼명인 `source_issue_no`에 매핑
- 기존 dashboard drill-down 파라미터를 최대한 원본과 동일하게 매핑
  - `team`, `subcontractor`, `subsub`, `hdecPic`, `hdecEng`, `capturedBy`, `level`, `mainTrade`, `subTrade`, `workType`, `classificationSource`, `status`, `closureStatus`, `issueNo`, `subcontractorIssueNo`, `dateStart`, `dateEnd`, `dateField`, `critical`, `priority`, `hdecVerification`, `hdecReason`, `notClosureDone`, `catADispute` 등

### 3. 테이블 UI를 원본과 맞춤
- 원본의 단일 scroll container + sticky header + sticky/frozen columns 구조 유지
- 상단 horizontal scrollbar를 원본 방식으로 표시
- frozen column 폭/좌표 계산 방식 정렬
- row 높이, header 높이, cell padding, truncate, hover, overdue/closed row tint를 원본과 맞춤
- header에 원본처럼 source origin 색상 적용
  - HDEC / Aconex / System origin에 따른 header background/border
- 컬럼 resize는 원본처럼 `onEnd` 기준으로 변경
- header resize handle double-click auto-fit 복원
- scroll 위치 저장/복원 복원

### 4. Stage Progress를 원본과 맞춤
- 현재 Badge 텍스트형 Progress를 원본의 pipeline 스타일 `DefectStageProgress`에 맞춤
- `DefectStageProgressLegend`를 검색줄 우측에 표시
- 지연/완료/종결 판정은 원본 로직과 동일하게 맞추되, 현재 필드명에 맞게 매핑

### 5. Critical / Bulk 기능을 원본과 맞춤
- 원본의 `CriticalBulkBar` 동작 복원
  - 선택 행 기준 critical pending 처리
  - 관리자 권한 반영
- 원본의 `CriticalPendingBar` UX와 맞춤
- 현재 단순 `BulkEditBar`를 원본의 `BulkActionBar` 수준으로 확장
  - 선택 건수 sticky action bar
  - 권한 확인 후 editable/skipped 표시
  - bulk edit confirm
  - selected rows export
  - TSV copy
  - reassign
  - duplicate/delete가 현재 데이터 모델과 권한 구조에서 가능한 범위까지 반영
- Closed 탭/Closed 데이터 편집 정책은 기존 논의대로 보호하되, UI는 원본과 최대한 동일하게 보이도록 처리

### 6. Export 기능을 원본과 맞춤
- `Export Excel` dialog를 원본 구조로 맞춤
  - View-friendly
  - Re-import ready
  - Single file
  - Subcontractor별 분리
  - 서브콘 7개 이상이면 ZIP 묶음
- 다만 25만행 대응을 위해 현재 화면의 100행만 export하는 문제는 수정
  - 현재 필터/검색/정렬 조건 전체 결과를 서버에서 페이지 단위로 가져와 export
  - 대용량은 브라우저 메모리 폭주를 막기 위해 CSV 우선 또는 chunked XLSX로 구현
- `Export` 라우트/버튼은 원본에 맞춰 별도 export 화면 또는 현재 프로젝트 구조에 맞는 경로로 연결

### 7. 댓글/메타 컬럼 기능 검토 및 반영
- 원본의 Issue No 옆 comment count/unread 표시 기능을 현재 backend에 대응되는 comment 데이터가 있으면 반영
- `_meta_instruction_count`, `_meta_comment_count`, `_meta_reply_count`, `_meta_last_activity_at` 같은 메타 컬럼은 현재 스키마가 지원하면 추가
- 현재 backend에 해당 테이블/RPC가 없으면 기능 껍데기만 만들지 않고, 필요한 DB/RPC를 함께 설계하여 원본 기능과 맞춤

### 8. 서버 페이지네이션 구조 유지
- 원본은 전체 데이터를 클라이언트 캐시에 올려 필터/정렬했지만, 현재 데이터량에서는 그대로 복원하면 다시 로딩 지연과 메모리 문제가 발생합니다.
- 따라서 UI/기능은 원본과 맞추되, 내부 데이터 흐름은 서버 기반으로 유지합니다.
- 필요한 RPC 보강
  - URL drill-down 필터 처리
  - AND 검색 처리
  - stage progress 필터/정렬 처리
  - export 전체 결과 스트리밍/페이지 fetch
  - facet count 정확도 개선

### 9. 현재 런타임 오류도 함께 해결
- 현재 preview에 `DataCloneError: Data cannot be cloned, out of memory`가 감지되었습니다.
- Raw Data에서 대량 객체를 query key, router state, performance 측정, export payload, localStorage 등에 넣는 경로를 점검합니다.
- URL/search/localStorage에는 큰 데이터가 아닌 최소 상태값만 저장하도록 수정합니다.
- export나 selected rows 처리도 전체 row 객체 대신 id/필드 목록 중심으로 바꿉니다.

## 구현 순서
1. SHAW 원본 Defect Raw Data의 구성 요소를 현재 프로젝트 필드명에 매핑
2. 현재 `DefectRawDataPage.tsx`를 원본 화면 구조 기준으로 재배치
3. 테이블 렌더링/sticky/frozen/resize/scroll 복원
4. URL 필터 칩, 컬럼 필터 칩, 검색, multi-sort 동작 복원
5. Stage Progress UI/Legend 복원
6. Bulk/Critical action bar를 원본 수준으로 확장
7. Export dialog와 대용량 export 처리 보강
8. 필요한 backend RPC/migration 추가 또는 보강
9. 25만행 기준으로 첫 진입, 탭 전환, 필터, 검색, export, row click을 검증

## 완료 기준
- 화면 배치와 주요 버튼/필터/테이블 UX가 SHAW PROJECT CMS Defect Raw Data와 일치
- 25만행에서도 페이지 진입 시 전체 데이터를 브라우저로 가져오지 않음
- 검색/필터/정렬/URL drill-down/export가 현재 전체 결과 기준으로 동작
- Closed/Unclosed 분리는 유지하되 원본 UX와 충돌하지 않게 같은 Raw Data 경험 안에서 제공
- 현재 out-of-memory 런타임 오류가 재현되지 않음