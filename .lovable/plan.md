
## 목표

1. `/closure/spare-part/records/:docRef` 상세페이지를 SHAW CMS의 Defect Detail 페이지와 동일한 UI 패턴으로 재구현하고 **모든 필드를 편집 가능**하게 구현
2. 기존 `issue_technical`, `issue_supplier`, `issue_internal` 세 필드의 텍스트를 시계열 **Status History** 코멘트로 1회 마이그레이션
3. 상세페이지에서 코멘트 직접 추가 + 각 코멘트에 대한 **답글(reply)** 기능
4. Excel 재업로드 시 세 필드 내용이 기존 코멘트와 다르면 자동으로 신규 코멘트 append

---

## 1. 데이터베이스 마이그레이션

### 신규 테이블: `spare_part_status_history`
- `id` uuid PK
- `doc_ref` text (인덱스, FK → `spare_parts_raw.doc_ref` ON DELETE CASCADE)
- `parent_comment_id` uuid nullable — 답글 트리
- `category` text: `'technical' | 'supplier' | 'internal' | 'general'`
- `message` text NOT NULL
- `source` text: `'migration' | 'excel_import' | 'app_manual'`
- `source_file_hash` text nullable — 재업로드 중복 감지
- `author_user_id` uuid nullable (마이그레이션/import는 NULL, 수동 입력은 auth.uid())
- `edited` boolean default false
- `created_at`, `updated_at`

**GRANT & RLS (같은 마이그레이션에서 실행):**
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_status_history TO authenticated`
- `GRANT ALL ... TO service_role`
- authenticated 전원 SELECT/INSERT 가능
- 본인 작성분 UPDATE/DELETE, admin/superuser는 `has_role()` 기반 전체 관리
- `updated_at` 트리거

### 1회 마이그레이션 SQL (동일 마이그레이션 내 실행)
```sql
INSERT INTO spare_part_status_history (doc_ref, category, message, source, created_at)
SELECT doc_ref, 'technical', TRIM(issue_technical), 'migration', COALESCE(updated_at, now())
FROM spare_parts_raw WHERE NULLIF(TRIM(issue_technical),'') IS NOT NULL;
-- supplier, internal 반복
```

기존 `issue_technical/supplier/internal` 컬럼은 **보존** (감사·엑셀 재업로드 diff 비교용). Raw Data 그리드에는 계속 노출하되, 상세페이지에서는 편집 필드가 아닌 Status History 카드로 대체.

---

## 2. 상세페이지 UI (`SparePartDetailPage.tsx`)

SHAW의 `DefectDetailPage.tsx` 구조를 참고하여 카드 그룹으로 구성. **admin/superuser 는 모든 필드를 편집** 가능하며, 그 외 사용자는 read-only.

카드 구성 (그룹은 `columns.ts`의 `group` 값 기반으로 자동 배치):

```
┌ Header       : Doc Ref · Subject · Approval Badge · ← Raw Data
├ Identification : doc_ref (RO), plot, discipline, subject, category
├ Vendor         : supplier, manufacturer
├ Approval       : approval_status, revision, approval_code, is_duplicate
├ Quantity       : qty_total, qty_delivered
├ Cost           : cost_impact_usd, cost_impact_qar
├ SPL            : spl_req_contract/mmjv/hdec, spl_list_code, spl_list_target, spl_list_approved
├ Availability   : physical_supply, physical_list_agreed, physical_remarks,
                   rec_letter_2y/5y, availability_10y, doc_others, phy
├ Procurement    : proc_category, rfq_progress, quotation_progress/target/done,
                   po_progress/target/done
├ Delivery       : delivery_progress, delivery_target, delivery_done
├ Remarks        : action, remarks, proc_remarks
└ Status History : (아래 3절)
```

### 필드 렌더러 (type 기반, `SPARE_PART_COLUMNS[i].type` 사용)
- `text` → `<Input>` / 긴 텍스트(remarks, action, proc_remarks 등)는 `<Textarea>`
- `number`, `cost` → `<Input type="number">`
- `progress` → 0–100 숫자 인풋 + Progress 시각화
- `date` → `<Input type="date">`
- `boolean` → `<Switch>` (Y/N)
- `badge` (approval_code, plot) → `<Select>` (APPROVAL_CODES / ["C","D"])

`doc_ref`는 편집 금지(PK). `raw_payload`, `custom_payload`, `is_active`, `imported_at`, `updated_at` 등 시스템 컬럼은 노출하지 않음.

### 저장 로직
- 단일 `Save` 버튼. 변경된 필드만 diff → `spare_parts_raw` update
- 필수 검증: 빈문자열 → NULL 정규화, 숫자/날짜 zod 스키마 검증(client + toast 오류)
- 저장 성공 시 `updated_by = auth.uid()`, `updated_at = now()`
- React Query `invalidateQueries(['spare-parts-raw'])` + `['spare-part-detail', docRef]`

### 편집 권한
- `useCurrentUser().isAdmin || isSuperUser` → 편집 가능
- 그 외 사용자: 모든 인풋 `disabled`, Save 버튼 숨김
- Status History 코멘트 작성은 authenticated 사용자 전원 허용

---

## 3. Status History 컴포넌트 (`SparePartStatusHistory.tsx`)

SHAW `DefectComments.tsx` 축약본:

- **표시**: 시계열(오름차순) 스크롤 영역. 각 항목:
  - Category 배지: `technical`(sky) / `supplier`(amber) / `internal`(violet) / `general`(slate)
  - 작성자명 (마이그레이션·import는 "System · migration" / "System · excel"), 상대 시간
  - 본문(pre-wrap), 답글 트리 (depth 들여쓰기, `parent_comment_id` self-ref)
  - 본인 또는 admin: Edit / Delete
  - 하단 Reply 버튼
- **작성 폼**: Category `<Select>` + `<Textarea>` + Send. Reply 모드에서는 category 부모 상속.
- **실시간**: `supabase.channel().on('postgres_changes', ...)` 로 자동 갱신
- 클라이언트/서버 zod 검증: message 1–2000자

---

## 4. Excel 재업로드 로직 (자동 신규 코멘트)

`SparePartImportContext.tsx`의 `executeImport` 안에서 upsert 완료 후 별도 후처리 단계 추가:

1. 파일별로 `parsed` 행을 순회, `doc_ref` chunk(500)로 `spare_part_status_history` 조회
2. 각 행의 `issue_technical`, `issue_supplier`, `issue_internal` 을 `normalize(s) = s.trim().replace(/\s+/g,' ')` 로 정규화
3. 해당 `doc_ref` + `category` 로 이미 저장된 어떤 message와도 정규화 매칭이 안 되면 신규 insert:
   ```json
   { doc_ref, category, message, source:'excel_import',
     source_file_hash: file.fileHash, author_user_id: userId }
   ```
4. 동일 파일 반복 실행 방지: `UNIQUE(source_file_hash, doc_ref, category, message)` 인덱스 (source_file_hash NULL 은 UNIQUE 대상 제외)
5. import 로그의 `warnings` 에 추가된 코멘트 카운트 병기

---

## 5. 파일 변경 목록

**신규**
- `supabase/migrations/*.sql` — 테이블 + GRANT + RLS + 1회 마이그레이션 INSERT + UNIQUE 인덱스
- `src/hooks/useSparePartStatusHistory.ts` — fetch/insert/update/delete + realtime 구독
- `src/hooks/useSparePartRecord.ts` — 단일 doc_ref 상세 fetch/update
- `src/components/spare-part/detail/SparePartDetailPage.tsx`
- `src/components/spare-part/detail/SparePartStatusHistory.tsx`
- `src/components/spare-part/detail/FieldRenderer.tsx` — type별 인풋 스위칭
- `src/lib/spare-part/detail-schema.ts` — zod 검증 스키마

**수정**
- `src/routes/_authenticated/closure/spare-part/records.$docRef.tsx` — stub 제거, 실제 페이지 마운트
- `src/contexts/SparePartImportContext.tsx` — import 완료 후 History diff-append 로직
- `src/integrations/supabase/types.ts` — 마이그레이션 승인 후 자동 재생성

---

## 기술적 세부사항

- `has_role(auth.uid(),'admin' | 'superuser')` RPC 재사용 — 기존 함수 그대로
- 상세페이지는 `_authenticated/` 하위 라우트 → SSR 인증 이슈 없음
- 답글은 별도 카테고리를 만들지 않고 `parent_comment_id`로만 구분 (UI에서 "reply" 배지)
- Import diff 비교 시 대용량 대응: `doc_ref` chunk 500 단위, 메시지 정규화 in-memory Set 사용
- 필드가 46개로 많으므로 카드 안에서 `grid grid-cols-1 md:grid-cols-2` 로 컴팩트하게 배치
- 편집 상태는 로컬 `form` state, `record`와 diff 비교하여 dirty 필드만 payload에 포함 (기존 SHAW 저장 로직과 동일 패턴)
