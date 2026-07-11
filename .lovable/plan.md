## 배경 — 두 가지 문제

### 1) `C4 셀에서 Data Date를 읽지 못했습니다` 에러
업로드한 파일의 `Gantt` 시트 실제 배치는 다음과 같음:
- **B4** = `"Data Date ▶"` (라벨)
- **C4** = 비어있음
- **D4** = `2026-07-10` (실제 날짜)

현재 parser (`src/lib/task-management/parser.ts` L196~200)는 `C4`만 하드코딩하여 읽음. 따라서 라벨 위치에 따라 값이 밀린 파일은 무조건 실패.

### 2) 컬럼 매핑 선택 기능 부재
현재 Import 시 헤더 매핑은 다음 두 곳에서 사용:
- `task_management_header_mappings` 테이블 (전역 alias)
- Row 5 헤더 텍스트 기반 자동 매칭 (`buildHeaderMap` + `resolveColumn`)

문제:
- 파일별로 컬럼 순서·헤더명이 다르면 사용자가 수정할 방법이 없음
- 자동 매칭 실패 시 그냥 canonical index로 fallback (조용히 잘못된 컬럼 읽음)
- 파일 카드 위에서 매핑을 눈으로 확인/수정할 UI가 없음

---

## 계획

### A. Data Date 파싱 유연화 (parser.ts)

`parseTaskManagementExcel`에서 다음 순서로 Data Date를 탐색:

1. **행 4 스캔**: B4~F4 범위에서 첫 번째 유효 날짜 값을 찾아 사용
2. **라벨 기반 탐색**: 행 3~5 중 `"Data Date"`, `"data date"`, `"기준일"` 등의 텍스트를 가진 셀을 찾고, 같은 행의 오른쪽/아래에서 첫 날짜 값 채택
3. 여전히 없으면 warning + `dataDate = null` (기존 동작)

`ParseTaskManagementResult`에 `dataDateCell: string | null` (예: `"D4"`)을 추가하여 UI에서 어느 셀에서 읽었는지 표시.

### B. 파일별 Data Date 수동 입력 UI (ImportPage)

파일 카드에 다음 요소 추가:
- Data Date 자동 감지 성공 시: `Data Date 2026-07-10 (D4에서 감지)` 배지 + `수정` 버튼
- 실패 시: 빨간 배너 대신 **날짜 입력 필드(input type=date)** 를 즉시 표시하여 사용자가 직접 입력 → Ready 상태로 전환
- Context `TmImportFileItem`에 `dataDateOverride?: string` 추가, 실제 upsert 시 `dataDateOverride ?? parsed.dataDate` 사용

### C. 파일별 컬럼 매핑 선택기 (신규 UI)

파일 카드에 `컬럼 매핑` 버튼 추가 → Dialog 오픈:

```text
┌─ 컬럼 매핑 (파일별) ─────────────────────────────┐
│ 필드              엑셀 컬럼 (행 5 헤더)   미리보기 │
│ task_no      →    [B: No           ▼]   AC-T-01… │
│ category     →    [C: Category     ▼]   Tier     │
│ plot         →    [D: Plot         ▼]   L01      │
│ task_name    →    [E: 항목          ▼]   Wall…    │
│ … (전체 19개 필드)                              │
│                                                  │
│           [기본값 복원]  [취소]  [적용]          │
└──────────────────────────────────────────────────┘
```

동작:
- 좌측: parser의 canonical target 필드 목록 (`task_no`, `category`, … `auto_judgment`)
- 우측 Select: 엑셀 시트의 A~S열 중 선택 (행 5 헤더 텍스트를 라벨로 표시, 예: `E: 항목`)
- 미리보기: 6행 첫 번째 데이터 값
- 초기값: 현재 자동 매핑 결과 (headerMap → column index)
- 적용 시 `TmImportFileItem.columnOverrides: Record<TargetField, number>` 저장
- 다시 파싱을 트리거하지 않고, upsert 시점에서 `parser.ts`에 `columnOverrides`를 넘겨 사용

Parser 시그니처 확장:
```ts
parseTaskManagementExcel(
  file: File,
  opts?: { extraAliases?: ...; columnOverrides?: Record<string, number> }
)
```
`resolveColumn` 앞단에서 override가 있으면 우선 채택.

### D. Context / 흐름 변경 (`TaskManagementImportContext.tsx`)

`TmImportFileItem`에 필드 추가:
- `dataDateOverride: string | null`
- `columnOverrides: Record<string, number> | null`
- `sheetHeaders: { col: number; letter: string; header: string; sample: string | null }[]` (매핑 다이얼로그용, 파싱 결과에서 수집)

Import 실행 시:
1. Override가 있으면 파일을 다시 파싱(재-parse, 사용자 확정 매핑 반영)
2. 재파싱 실패 시 파일 카드에 에러 표시
3. Data Date는 override 우선

### E. Ready 판정 로직 변경

기존: `parsed.dataDate` 없으면 `validationError`  
변경: `parsed.dataDate` 없어도 `dataDateOverride` 있으면 Ready. 둘 다 없으면 여전히 Not Ready + 파일 카드에서 입력 유도.

---

## 파일 변경 목록

- **수정** `src/lib/task-management/parser.ts`  
  Data Date 유연 탐색, `columnOverrides` 지원, sheet header 목록 수집 반환
- **수정** `src/contexts/TaskManagementImportContext.tsx`  
  `dataDateOverride`, `columnOverrides`, `sheetHeaders` 상태 및 저장 시 반영
- **수정** `src/components/task-management/import/TaskManagementImportPage.tsx`  
  파일 카드에 Data Date 인라인 편집, `컬럼 매핑` 버튼 추가
- **신규** `src/components/task-management/import/ColumnMappingDialog.tsx`  
  필드↔엑셀 컬럼 매핑 편집 다이얼로그

DB 스키마 변경은 없음 (전역 `task_management_header_mappings`는 그대로 유지 — 파일별 override는 클라이언트 세션 한정).

---

## 확인 방법

1. 업로드한 `20260710_Task_Management_건축-4.xlsx`를 다시 드래그
   - 카드에 `Data Date 2026-07-10 (D4에서 감지)` 표시, `Ready` 상태
2. `컬럼 매핑` 버튼 클릭 → 19개 필드가 자동 매핑된 상태로 표시
3. Ready 상태에서 Import 실행 → 정상 upsert 확인
