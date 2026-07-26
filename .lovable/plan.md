## 목표
ABD Import 페이지 상단의 공용 카드 `Import 대상 필드 선택 (HDEC) / Sync 대상 필드 선택 (Aconex)`를 폐기하고, 앱 전반(SM/TM/DMR/SP)에서 이미 사용 중인 파일 행별 **컬럼 선택 버튼 → `ColumnSelectDialog`** 패턴으로 대체.

## 폐기
`src/components/abd/import/AbdImportPage.tsx` 484~568줄 카드 및 관련 상태·파생값:
- `selectedSet` / `setSelected` / `fieldOptions`
- `selectAllFields` / `clearAllFields` / 카드용 `applyPreset`
- `hdecExcludedFields`, `aconexSelected`, `syncFields`

## HDEC 모드
파일 행마다 `컬럼 선택` 버튼(제외 수 뱃지 포함) → 공용 `ColumnSelectDialog` 오픈. TM 임포트(`TaskManagementImportPage.tsx` 524~535줄) 패턴 그대로.

1. `FileEntry`에 `excludedHeaders: string[]`, `availableHeaders`, `headerSamples`, `headerToFieldMap` 추가.
2. `parseAbdFile` 결과에서 헤더/샘플/매핑을 노출(부족하면 파서 출력 확장).
3. `ColumnSelectDialog` `presets` prop에 `abd_import_presets`(mode='hdec') 주입 — 프리셋의 canonical `fields` → 파일 헤더 중 매핑되는 `matchedHeaders`로 변환.
4. `importAbdBatch` 호출 시 파일별 `excludedHeaders` → canonical field 배열로 변환하여 `excluded_fields`로 전달(서버함수 시그니처 유지).
5. `lockRequired={true}` 옵션으로 `abd_number` 등 필수 컬럼 잠금(관리자 페이지에서는 `false`).

## Aconex 모드
`AbdAconexImportPage` 내부 파일 행에도 동일한 `컬럼 선택` 버튼 배치 — 6개 sync 필드에 대응하는 헤더만 후보. 프리셋 mode='aconex' 주입. 상단 안내 Alert 문구를 "각 파일의 컬럼 선택 버튼에서 UPDATE 대상 컬럼을 지정"으로 조정.

## Mapping 페이지
`AbdImportPresetTable`(HDEC Preset / Aconex Preset 탭)은 **변경 없음**. 프리셋 편집 위치 그대로.

## 영향 파일
- `src/components/abd/import/AbdImportPage.tsx` — 카드 제거, FileRow에 버튼 추가, 다이얼로그 마운트, `excluded_fields` 산출 로직 교체
- `src/components/abd/import/AbdAconexImportPage.tsx` — 파일별 컬럼 선택 배선
- `src/lib/abd/parser.ts` — 필요 시 헤더/샘플/매핑 노출
- `src/lib/abd/mutations.functions.ts` — 무변경 (`excluded_fields` 그대로 수신)

## 검증
- 타입체크 통과 확인
- HDEC 파일 업로드 → 파일별 `컬럼 선택`으로 제외 헤더 지정 → 임포트 결과에서 제외 필드가 upsert에서 빠지는지 확인
- Aconex 파일 업로드 → 파일별 컬럼 선택 → UPDATE 실행 필드가 지정된 것만인지 확인
- 프리셋 버튼 다이얼로그 내 노출 확인

## 확인 필요
Aconex 모드도 HDEC와 동일하게 파일별 `컬럼 선택` 버튼으로 통일하는 게 기본안입니다. Aconex는 파일마다 6개 sync 필드를 항상 전체 UPDATE 하도록 두는 편이 낫다면 알려주세요.
