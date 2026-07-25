
## 배경

Raw Data 보유 모듈 중 HDEC PIC 축으로 필터링·개인화가 불가능한 모듈은 **DMR**과 **Spare Part** 두 곳입니다. DMR은 성격상 PIC 축이 없지만, Spare Part는 이미 `issue_owner`(자유 텍스트) → `owner_user_id` 트리거가 존재해 담당자 개념이 자연스럽게 존재합니다. 요청하신 대로 SM/TM/ABD와 **동일 수준**으로 이식합니다.

## 스코프

### 1. DB 스키마 (migration)
- `spare_parts_raw`에 컬럼 추가
  - `hdec_pic_name text`
  - `hdec_eng_name text`
- 인덱스 (Raw Data 서버 필터 성능): `hdec_pic_name`, `hdec_eng_name` 대상 btree + trigram(pg_trgm)
- `spare_parts_auto_owner_user_id` 트리거 함수 개편
  - 우선순위: `hdec_pic_name` → `hdec_eng_name` → `issue_owner`
  - profiles.hdec_pic_name / hdec_eng_name 매칭 결과가 있으면 그 user_id 사용, 없을 때 기존 `resolve_owner_by_name(issue_owner)` 폴백
- `profiles_propagate_to_raw` 트리거: 기존 SM/TM/ABD와 동일하게 `spare_parts_raw`도 propagate 대상에 포함(이름 변경 시 raw 동기화)
- `spare_part_field_config` 시드: `hdec_pic_name` / `hdec_eng_name` 항목 추가(visible=true, group=id, sort_order 조정)

### 2. TypeScript 컬럼 정의
- `src/lib/spare-part/columns.ts`
  - `SPARE_PART_COLUMNS` 배열에 두 필드 삽입 (group `"id"`, 라벨 "HDEC PIC" / "HDEC ENG", width 130/140)
  - `RAW_SEARCH_FIELDS`에 `hdec_pic_name`, `hdec_eng_name` 추가
  - `BULK_EDITABLE_FIELDS`에 둘 다 추가 (SM/TM/ABD 정책과 동일)

### 3. Import 매핑
- `src/lib/spare-part-import-parser.ts`: 헤더 후보 사전에 `"HDEC PIC"`, `"HDEC Engineer"`, `"HDEC ENG"`, 국문 표기 후보 추가
- `spare_part_header_mappings` 기본 매핑 시드 추가
- `SparePartImportContext`: preview / diff / upsert payload에 두 필드 포함
- 임포트 대시보드 `FieldLogTable` 자동 노출 (기존 스키마 반영)

### 4. Raw Data UI
- `SparePartRawDataPage.tsx`
  - 신규 컬럼 자동 렌더링 (기존 `SPARE_PART_COLUMNS` iteration 기반이라 정의 추가로 확보)
  - `ColumnFilters`: `hdec_pic_name` / `hdec_eng_name`를 multi-select 파셋으로 노출
  - `DEFAULT_ORDER` / 사용자 저장 컬럼 순서에 두 필드 포함, 기본 노출
- `SparePartDetailPage.tsx` `FieldRenderer` 자동 반영 (field_config 기반)

### 5. 자동 배정 (Auto-fill) 규칙
- SM의 `HdecPicRuleTab`을 참고하여 Spare Part 전용 `spare_part_hdec_pic_rules` 테이블 추가
  - 매칭 축: `plot`, `discipline`, `category` (Spare Part 도메인에 맞춤)
  - 신설 `spare-part/settings` 서브탭에서 관리
- 저장/변경 시 트리거로 값 propagate

### 6. MWS / MTWS 연동
- `useMyWorkspaceData.ts`에 Spare Part 브랜치 추가 (기존 SM/TM/ABD 패턴 재사용)
- 서버 집계 함수 신설
  - `sp_my_workspace_counts(user_pic text, user_team text, mode text)`
  - `sp_my_workspace_rows(...)` — Today / Delayed / Upcoming / Overdue 등 SM과 동일 스키마
- MWS/MTWS UI 탭에 "Spare Part" 카드 추가 (기존 Snag 카드 컴포넌트 재사용, 컬럼 세트만 spare_part용으로 매핑)
- "전체" 탭 클릭 시 현재 필터를 들고 `/procurement/spare-part/raw-data`로 이동 (SM과 동일 규칙)

### 7. 권한
- `spare_parts_raw` RLS는 그대로. `owner_user_id` 기반 `is_row_owner` / `can_edit_row` 정책이 이미 존재하므로 추가 정책 불필요.
- `updateSparePartOwnerField` 유사 로직이 없다면 TM와 같은 인라인 편집 훅 신설 (senior_user / d_superuser만 PIC 변경 가능)

### 8. 데이터 백필
- 이미 존재하는 행에 대해 issue_owner 텍스트 기반으로 hdec_pic_name 추정 백필은 하지 않음(스팸 방지). 신규 임포트부터 채워짐.
- 필요 시 추후 별도 마이그레이션.

## 사용자 확인 필요

1. Auto-fill 규칙의 매칭 축을 `plot / discipline / category`로 잡았는데, Spare Part에서 실제로 담당 배분에 쓰는 축이 다르면 알려주세요.
2. MWS에서 Spare Part "Today / Delayed / Upcoming" 기준을 어느 날짜 컬럼으로 계산할지 (`spl_list_target`, `quotation_target`, `po_target`, `delivery_target` 중 우선순위). 초안은 "가장 임박한 미완료 단계 target"으로 설계합니다.

## 파일 변경 요약

- 신규: `supabase migration` (컬럼·인덱스·트리거·rule 테이블·RPC)
- 신규: `src/components/spare-part/settings/HdecPicRuleTab.tsx`
- 수정: `src/lib/spare-part/columns.ts`, `spare-part-import-parser.ts`, `SparePartImportContext.tsx`, `SparePartRawDataPage.tsx`, `ColumnFilters.tsx`, `useMyWorkspaceData.ts`, MWS/MTWS 페이지, 사이드바 라우팅
