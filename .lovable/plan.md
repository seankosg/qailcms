# TM Raw Data — PIC → HDEC PIC / HDEC ENG 분리 (확정안)

## 확정된 결정
1. 한 셀에는 한글 또는 영문 하나만 존재 (혼재 없음).
2. 기존 `pic` 컬럼은 **즉시 제거**.
3. Gantt export 원본 H열 → 두 컬럼(H `hdec_pic_name`, I `hdec_eng_name`)으로 확장, 이후 letter 재정렬.

## 1. DB 마이그레이션
- `task_management_raw`에 `hdec_pic_name text`, `hdec_eng_name text` 컬럼 추가.
- 기존 `pic` 값 백필: 한글 정규식(`[가-힣]`) 매칭 → `hdec_pic_name`, 그 외 Latin → `hdec_eng_name`.
- 인덱스 추가: `idx_tm_raw_hdec_pic (hdec_pic_name)`, `idx_tm_raw_hdec_eng (hdec_eng_name)`.
- 기존 `idx_task_management_raw_pic` 및 `pic` 컬럼 DROP.
- `trg_profiles_propagate_to_raw` 트리거 확장: profiles의 `hdec_pic_name` / `hdec_eng_name` 변경 시 `task_management_raw`도 동기화.

## 2. 파서 (`src/lib/task-management/parser.ts`)
- `ParsedTaskRow.pic` 제거, `hdec_pic_name`, `hdec_eng_name` 추가.
- `TASK_TARGET_FIELDS` 갱신 (`pic` 제거, 두 필드 추가).
- 헤더 인식:
  - `hdec_pic_name` ← "담당", "담당자", "HDEC PIC", "PIC(한글)", "PIC 한글"
  - `hdec_eng_name` ← "HDEC ENG", "PIC(영문)", "ENG", "Engineer", "PIC (Eng)"
- 레거시 파일(단일 "담당" 컬럼)의 셀 값에 한글이 있으면 `hdec_pic_name`, 아니면 `hdec_eng_name`로 라우팅.
- 두 컬럼이 모두 존재하면 각각 그대로 채움.

## 3. 컬럼/UI
- `src/lib/task-management/columns.ts`:
  - `TM_COLUMNS`의 `pic` 항목을 두 개로 교체 (HDEC PIC / HDEC ENG, editable, select 에디터).
  - `TM_SEARCH_FIELDS`, `TM_EDITABLE_FIELDS`에서 `pic` → 두 신규 필드.
  - `TM_GANTT_ORIGINAL_ORDER` H→I 이후 letter 전면 재부여(H=hdec_pic_name, I=hdec_eng_name, 이후 J..U로 밀림).
- `EditCellPopover`: 두 필드는 select editor로 각각 `useMasterOptions("hdec_pic")` / `"hdec_eng"` 옵션 사용.
- Detail 시트(`TaskDetailPage`), BulkEditBar, ColumnFilters, RawDataPage 등에서 `pic` 참조를 두 필드로 교체.

## 4. Header Mapping / Field Config 어드민
- 마이그레이션에서 `task_management_header_mappings`의 기존 `pic` 대상 레코드를 헤더 텍스트에 따라 분리 이관(한글/영문 판별 후 각 필드로 재바인딩).
- `task_management_field_config`에서 `pic` 항목 삭제, 신규 두 필드 등록(라벨/노출/정렬).

## 5. Import Preflight & 마스터 매칭
- `src/lib/task-management/import-preflight.functions.ts` 및 fuzzy master match: `pic` 검증을 두 필드로 분리 — 한글은 `hdec_pic_master`와, 영문은 `hdec_eng_master`와 유사 매칭.
- `MasterMappingSection` UI에 HDEC PIC / HDEC ENG 두 카테고리 표시.

## 6. Rollup / Derived / 기타
- `rollup.functions.ts`, `derived.ts`, filters, bulk-actions 등에서 `pic` 참조 전면 교체.
- Export/Excel 생성기(`stream-export.ts`, `styled-workbook.ts`): 헤더 라벨 및 셀 매핑 갱신(H "담당(한글)", I "담당(영문)").
- Task Tree, Dashboard 위젯(BehindScheduleTable, CriticalWatchlist 등)의 담당자 표시는 `hdec_pic_name ?? hdec_eng_name`로 폴백.

## 7. 검증
- 마이그레이션 후 백필 결과 카운트 확인.
- 샘플 파일 재임포트 → 두 컬럼에 올바르게 분배되는지 확인.
- Raw Data 페이지, Detail, BulkEdit, Export 각각 회귀 테스트.
