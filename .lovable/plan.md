## Defect Import: 미매핑 5개 컬럼 매핑 로직 추가

### 배경

업로드하신 `Overall_open_39146_processed_1.xlsx` 헤더 31개 중 아래 5개가 현재 매핑에서 빠져 있습니다. 나머지 26개(`Team` 포함)는 정상 매핑됩니다.

| 파일 헤더 | 신규 canonical field | DB 컬럼 타입 |
|---|---|---|
| `Building` | `building` | text NULL |
| `Room` | `room` | text NULL |
| `Room Group` | `room_group` | text NULL |
| `Level` | `level_name` | text NULL |
| `ReviewFlag` | `review_flag` | text NULL |

`Level`은 기존 `area_level`(Location에서 파생되는 별개 필드)과 충돌하지 않도록 컬럼명을 `level_name`으로 둡니다.

### 변경 사항

**A. DB 마이그레이션**

`public.defect_items_raw`에 5개 text NULL 컬럼 추가. RLS/GRANT는 테이블 단위로 이미 설정되어 있어 컬럼 추가만으로 충분.

**B. `src/lib/defect-management/parser.ts`**
- `DEFECT_TARGET_FIELDS`에 `building`, `room`, `room_group`, `level_name`, `review_flag` 추가.
- `CANONICAL_HEADERS`에 매핑 추가: `building → building`, `room → room`, `roomgroup → room_group`, `level → level_name`, `reviewflag → review_flag` (`normalizeHeader`가 공백 제거 후 소문자화).
- `ParsedDefectRow`에 5개 필드(`string | null`) 추가.
- `parseDefectExcel`의 row 생성 블록에서 5개 필드를 `toStr(getCell(...))`로 채우기.

**C. `src/contexts/DefectManagementImportContext.tsx`**
- `payloads` 생성부에 `put(base, "building", p.building)` 등 5개 `put` 호출 추가.

**D. Column Select / UI**
- 5개 신규 필드는 `isKnownDefectField`가 자동으로 true를 반환하여 Column Select Dialog의 unmapped 배지가 사라짐. HDEC_FIELDS 등 프리셋 변경 없음.
- Raw Data 테이블 컬럼/필터/편집·Export 노출은 이번 스코프 밖(후속). 임포트/DB 저장은 정상 동작.

### 산출물

- 마이그레이션 1건 (defect_items_raw ADD COLUMN × 5)
- 수정: `src/lib/defect-management/parser.ts`, `src/contexts/DefectManagementImportContext.tsx`

### 검증

- 마이그레이션 승인·실행 → `types.ts` 재생성 → `bunx tsgo --noEmit`.
- 업로드하신 파일로 임포트 후 SQL로 신규 5개 컬럼 값 저장 확인.
- 해당 컬럼이 없는 기존 파일 회귀 확인 (모두 null이면 OK).

### 후속 (이번 계획 밖)

- Raw Data 페이지 컬럼 표시/필터/편집·Export에 5개 필드 노출.
- `defect_field_config`에 라벨/정렬 시드.
