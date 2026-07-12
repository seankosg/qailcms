## 새 규칙 (메모리 저장 예정)

**지시사항을 축약/생략/변경하려 할 때는 반드시 사전에 사용자에게 확인할 것.** 임의 판단으로 스코프를 줄이거나 다른 방식으로 대체하지 않음. 이 규칙은 승인 후 빌드 모드로 전환되는 즉시 `mem://index.md`의 **Core**에 저장합니다(플랜 모드에서는 메모리 파일 편집이 차단됨).

또한 이번 실수(SHAW `ColumnSelectDialog` 기능을 단순 매핑 다이얼로그로 축약한 건)는 위 규칙 위반이었음을 인정합니다.

---

## 배경 — 왜 지시대로 안 되었는지

Phase 2 구현 시 "컬럼 매핑"을 SHAW의 `DefectColumnSelect`(=`ColumnSelectDialog` 기반의 컬럼 포함/제외 + 프리셋 + 필수/소스 배지 + 샘플 프리뷰 UI)가 아니라, **헤더→필드 재매핑 드롭다운**만 있는 단순 다이얼로그(`DefectColumnMappingDialog`)로 축약했습니다. 그 결과 다음 SHAW 기능들이 누락됐습니다.

**누락된 SHAW 기능**
- Excel Column | Maps to Field | Sample 3열 리스트 + 첫 데이터 행 프리뷰
- Required 뱃지 + 사유(system / reimport / config) 툴팁, 필수 제외 시 경고 카운트
- Source(HDEC/Aconex/System) 색상 배지, Unmapped 필드 표시
- Preset 4종: **New Upload / Update from Aconex / HDEC's Update / Cat Check**
- Select all / Deselect all / Reset
- 하단 Warnings 박스 (필수 제외, `area_raw` 제외 시 파생 필드 초기화 경고 등)
- 다중 시트 파일 → **Sheet 선택** UI (`pending_sheet_selection`)
- **Re-import 감지**(`SHAW_DEFECT_REIMPORT_V1` 마커) → update-only 모드 + `id` 필수
- 파일 카드 상단 "Select Columns (N/Total)" 카운터 뱃지

## 스코프

이번 요청 범위 = **Import UI/컬럼 선택 기능의 SHAW 반영**. Team은 수동 선택 강제(기존 확정 유지). SC 번호 자동 발번은 이번 단계 밖. Preset 4종은 **UI/컬럼 필터 로직만** 이식(팀별 후속 워크플로우 로직은 별도 논의).

> 이 스코프에서 축약/변경이 필요한 지점이 나오면 진행 전에 반드시 사용자에게 확인.

## 구현 계획

### 1. 범용 ColumnSelectDialog 이식
- 신규: `src/components/import/ColumnSelectDialog.tsx`
- SHAW 파일 그대로(shadcn Dialog/Checkbox/Badge/Button만 의존). `ColumnSelectHelpers`, `ColumnRequirement`, presets 프롭 동일.

### 2. Defect 전용 래퍼 이식
- 신규: `src/components/defect-management/import/DefectColumnSelect.tsx`
- `toFieldName`은 기존 `src/lib/defect-management/parser.ts`의 canonical 매핑 사용.
- `useDefectFieldConfig`에 `getSourceLabel(field)`, `getSourceOrigin(field)` 헬퍼 추가.
- 프리셋 4종 SHAW 규칙 그대로(ACONEX/HDEC/CAT_CHECK 필드셋 동일).
- `area_raw` 제외 시 파생 초기화 경고 이식.

### 3. Field Config 스키마 확장
- 마이그레이션: `defect_field_config`에 `origin text CHECK IN ('hdec','aconex','system')`, `source_label text` 컬럼 추가.
- 기존 시드 UPDATE로 origin 채움(규칙: `hdec_*`→hdec, `aconex_*`→aconex, 그 외→system).
- `DefectFieldConfigTable`에 두 컬럼 편집 UI 노출.

### 4. Import Context 확장 (`DefectManagementImportContext.tsx`)
파일 상태 필드 추가:
- `availableHeaders: string[]`, `headerSamples: Record<string, unknown>`
- `excludedHeaders: string[]`, `excludedFields: Set<string>`
- `sheetNames: string[]`, `selectedSheet: string`, 상태 `pending_sheet_selection`
- `isReimport: boolean`

Actions: `setFileSheet(id, sheetName)`, `setFileExcludedHeaders(id, excluded)` (재파싱 트리거).

### 5. Parser 확장 (`src/lib/defect-management/parser.ts`)
- `getDefectExcelSheetNames(file)`, `getDefectExcelHeaders(file, sheet?)` 추가.
- `parseDefectExcel(file, sheetName?, excludedHeaders?)` — 제외 헤더 컬럼은 결과에서 제외.
- `SHAW_DEFECT_REIMPORT_V1` 마커 감지 → `isReimport: true`.

### 6. Import Worker 로직 반영
- `excludedFields`에 포함된 필드는 upsert payload에서 제거(기존 DB 값 보존).
- `isReimport === true` → **update-only**: `source_issue_no` 매칭 기존 row만 UPDATE, 신규 INSERT skip.
- 기존 `priority_locked` / `hdec_verification_locked` skip 유지.

### 7. Import Page UI 갱신
- Sheet 다중일 때 Select (해당 상태에서 실행 버튼 비활성화).
- **"Select Columns (선택/전체)"** 버튼 → `DefectColumnSelect` 오픈.
- Re-import 파일에 "Re-import (Update only)" 뱃지 + 안내 문구.
- 기존 `DefectColumnMappingDialog` 제거.

### 8. 헤더 매핑 저장 흐름
현재 프로젝트의 `defect_header_mappings` 관리자 페이지 정책 유지 — ColumnSelect 다이얼로그 내 인라인 매핑 저장은 제공하지 않음(SHAW도 동일).

## 산출물

**신규**
- `src/components/import/ColumnSelectDialog.tsx`
- `src/components/defect-management/import/DefectColumnSelect.tsx`
- 마이그레이션: `defect_field_config` origin/source_label 컬럼 + 시드 업데이트

**수정**
- `src/lib/defect-management/parser.ts`
- `src/contexts/DefectManagementImportContext.tsx`
- `src/components/defect-management/import/DefectManagementImportPage.tsx`
- `src/hooks/useDefectFieldConfig.ts`
- `src/components/admin/DefectFieldConfigTable.tsx`

**제거**
- `src/components/defect-management/import/DefectColumnMappingDialog.tsx`

**메모리**
- `mem://index.md` Core에 "지시사항 축약/생략/변경 시 사전 확인" 규칙 추가(빌드 모드 전환 즉시 저장).

## 검증 시나리오
1. `Elec-_23667.xlsx` → Select Columns 다이얼로그가 열리고 모든 헤더가 Maps to Field에 표시되며 첫 행 샘플이 보인다.
2. Preset "HDEC's Update" → planned_*/actual_* 등 SHAW와 동일한 헤더만 남는다.
3. `Issue No` 제외 시 노란 경고 배너 + 카운터 표시.
4. `Area` 제외 시 "Type/Level/Location 파생 초기화" 경고 라인.
5. 컬럼 제외 후 Import → 해당 필드는 기존 DB 값 유지.
6. 다중 시트 xlsx → sheet select 노출, 선택 시 재파싱.
7. Field Config에서 origin='hdec' 필드는 파란 HDEC 배지.
