## 목표

`spare_parts_raw`의 legacy 필드 `issue_technical`, `issue_supplier`, `issue_internal`를 완전히 제거합니다. 해당 내용은 이미 `spare_part_status_history` 코멘트로 이전되어 있으므로, 앞으로는 코멘트만이 유일한 소스가 됩니다. 엑셀 파싱에서 이 세 컬럼이 들어오더라도 raw 테이블에는 저장하지 않고, 기존 diff-append 로직만 계속 유지됩니다.

---

## 1. 마이그레이션 (스키마)

`spare_parts_raw`에서 세 컬럼을 DROP하고, `spare_part_field_config`의 해당 row도 정리합니다.

```sql
ALTER TABLE public.spare_parts_raw
  DROP COLUMN IF EXISTS issue_technical,
  DROP COLUMN IF EXISTS issue_supplier,
  DROP COLUMN IF EXISTS issue_internal;

DELETE FROM public.spare_part_field_config
 WHERE field_key IN ('issue_technical','issue_supplier','issue_internal');

-- 헤더 매핑에도 남아 있다면 함께 정리 (사용자가 매핑을 손봤을 수 있으므로 조건부)
DELETE FROM public.spare_part_header_mappings
 WHERE target_field IN ('issue_technical','issue_supplier','issue_internal');
```

Status History 데이터는 그대로 유지됩니다(이미 마이그레이션된 코멘트).

---

## 2. 파서 (`src/lib/spare-part-import-parser.ts`)

- `SNAKE_IDENTITY_FIELDS`에서 `issue_technical/supplier/internal` 3개 항목 제거 → raw 스키마에 없는 컬럼이 struct에 들어가 upsert 오류가 나는 것을 방지합니다.
- 대신, 파싱 결과에 별도 필드 `issues: { technical?: string; supplier?: string; internal?: string }` 를 채워 반환하도록 합니다(엑셀에 이 헤더가 있으면 원문 텍스트만 담아둠). 헤더 인식은 기존 매핑 alias를 재사용하되, 최종 write target을 raw 컬럼이 아니라 이 별도 슬롯으로 라우팅합니다.
- ParsedRow 타입에 `issues?: { technical?: string|null; supplier?: string|null; internal?: string|null }` 추가.

---

## 3. Import Context (`src/contexts/SparePartImportContext.tsx`)

- upsert payload(`p`)는 이제 issue_* 컬럼을 포함하지 않으므로 그대로 안전.
- Status History diff-append 블록은 지금 `p.struct[field]`에서 값을 읽는데, 그 자리를 `p.issues.technical/supplier/internal`로 바꿉니다. 나머지 정규화·중복 방지·insert 로직은 그대로.

---

## 4. 컬럼/필드 정의

- `src/lib/spare-part/columns.ts` : `SPARE_PART_COLUMNS`에서 `issue_technical/supplier/internal` 3개 엔트리 삭제. `RAW_SEARCH_FIELDS`, `BULK_EDITABLE_FIELDS`에는 원래도 없어 별도 변경 없음.
- Raw Data 그리드/필터 UI는 columns.ts 기반 자동 렌더이므로 자연스럽게 사라집니다.
- 상세페이지(`SparePartDetailPage.tsx`)는 Status History 카드가 이미 이 정보를 담당하므로 별도 변경 없음.

---

## 5. 타입

마이그레이션 승인 후 `src/integrations/supabase/types.ts`가 자동 재생성되며 세 필드가 사라집니다. 코드에서 이 필드에 대한 직접 참조는 위 변경 이후에는 남지 않게 됩니다.

---

## 파일 변경 요약

**마이그레이션 (신규)**
- `supabase/migrations/*.sql` — 컬럼 DROP + field_config/header_mappings 정리

**수정**
- `src/lib/spare-part-import-parser.ts` — SNAKE_IDENTITY_FIELDS에서 3필드 제거, `issues` 사이드채널 추가
- `src/contexts/SparePartImportContext.tsx` — diff-append에서 `struct` 대신 `issues` 읽기
- `src/lib/spare-part/columns.ts` — 3개 컬럼 정의 제거

**변경 없음**
- Status History 데이터/테이블/컴포넌트
- 상세페이지 편집 UI

---

## 검증

- 재임포트 시 엑셀에 Issue 열이 있어도 raw 테이블에는 반영되지 않고, 새로운 값만 `spare_part_status_history`에 `excel_import` 소스로 추가되는지 확인.
- Raw Data 그리드/Export/필터에서 3개 컬럼이 완전히 사라졌는지 확인.
- 기존 History 데이터가 그대로 보이는지 확인.