
# Raw Data 컬럼 누락 수정 — localStorage 스키마 마이그레이션

## 문제

`src/lib/spare-part/columns.ts`의 `SPARE_PART_COLUMNS`를 업로드 엑셀 46개 필드로 재정의했으나, 이전 방문 시 저장된 `localStorage["qail.spare-part.raw-data:{userId}"]`의 `order` / `visibility` / `frozenExtras`에는 지금은 존재하지 않는 옛 키(`system_type`, `cost_usd`, `cost_qar`, `delivery_date`, `stage1_date` 등)만 담겨 있습니다. 로드 로직이 저장본을 우선 적용하기 때문에 신규 28여 개 컬럼이 `orderedKeys`에 들어가지 못해 그리드에 렌더되지 않습니다.

## 해결 방안

`SparePartRawDataPage.tsx`의 localStorage 로드 로직에 **스키마 버전 + 병합/정제**를 도입합니다. 사용자별 커스터마이징(리사이즈 폭 등 유효 항목)은 최대한 살리고, 사라진 키만 제거하며, 새로 추가된 키를 뒤에 붙입니다.

### 변경 파일

- `src/components/spare-part/raw-data/SparePartRawDataPage.tsx` (수정)

### 변경 내용

1. **스토리지 키 버전 접미어 추가**  
   `const storageKey = \`qail.spare-part.raw-data.v2:${userKey}\`` (기존 v1 자동 무시)

2. **로드 시 order 병합 로직**
   ```ts
   const validKeys = new Set(SPARE_PART_COLUMNS.map(c => c.key).filter(k => k !== "doc_ref"));
   const savedOrder = (s.order ?? []).filter(k => validKeys.has(k));
   const missing = DEFAULT_ORDER.filter(k => !savedOrder.includes(k));
   const mergedOrder = savedOrder.length ? [...savedOrder, ...missing] : DEFAULT_ORDER;
   setOrder(mergedOrder);
   ```

3. **frozenExtras 정제**  
   저장된 값 중 `validKeys`에 있는 것만 유지, 3개 미만이면 `DEFAULT_FROZEN_EXTRAS`에서 보충.

4. **visibility 정제**  
   `validKeys`에 없는 항목 제거 (오래된 `false` 플래그가 새 키를 억누르지 않도록).

5. **columnFilters 정제**  
   저장된 필터 중 `validKeys`에 없는 컬럼 항목 제거.

6. **sizing 정제**  
   저장된 컬럼 폭 중 `validKeys` + `__select` + `doc_ref`에 해당하는 것만 유지.

### 검증

수정 후 다음을 확인합니다.
- 페이지 최초 진입 시 46개 컬럼이 모두 나타남 (기본 프로즌: `doc_ref`, `plot`, `subject`, `approval_code`, 나머지 42개가 우측으로 이어짐)
- Columns 메뉴에서 46개 항목이 리스트업됨
- 이전 사용자도 새 컬럼이 자동 표시됨 (v2 키로 자동 초기화)
- 리사이즈/재정렬 후 재로드 시 사용자 조정이 유지됨

### 범위 밖 (이번 turn 미포함)

- DB 스키마 변경 없음
- 다른 파일(`ColumnOrderMenu`, `ExportDialog` 등) 로직 변경 없음
- 컬럼 정의 자체는 직전 turn에서 이미 완료
