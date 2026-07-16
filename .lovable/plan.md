## 근본 원인

**"업데이트 0, 신규 44,510"의 원인은 파서가 엑셀의 `id` 컬럼(시스템 UUID)을 `source_issue_no`로 잘못 읽고 있기 때문**입니다.

### 근거

1. 업로드된 `snag-raw-data-unclosed-...-v5.xlsx` 헤더 구조:
   - `A: id` (값 예: `9628e6a3-2378-4099-...` — 시스템 UUID)
   - `B: source_issue_no` (값 예: `100000` — 실제 LetsBuild Issue No.)
2. `defect_header_mappings` 테이블에 다음 두 별칭이 등록됨:
   ```
   source_issue_no ← "ID"
   source_issue_no ← "source_issue_no"
   ```
3. 파서 `resolveColumn`(src/lib/defect-management/parser.ts)이 alias 배열을 순회하며 헤더맵에서 먼저 잡히는 컬럼을 선택 → **A열(UUID)**이 `source_issue_no`로 결정됨.
4. 결과: upsert conflict key가 UUID가 되어 기존 numeric-ID 행(`99342` 등)과 매칭 실패 → 전부 새 행으로 insert.
5. DB 실측: `defect_items_raw`에 UUID 형태 44,510행, 숫자형 110,322행 공존. UUID 44,510은 이번 실패 임포트로 생긴 오염 데이터.

`toDefectFieldName`에서 `"id"`를 빈 문자열로 제외한 이전 수정은 확장 필드 매핑에만 적용되고, target field 컬럼 해석(`resolveColumn`)에는 영향을 주지 않아 문제를 해결하지 못했습니다.

---

## 수정 계획 (1,2,3 모두 진행)

### 1) 파서 우선순위 수정 — `src/lib/defect-management/parser.ts`

`resolveColumn` 우선순위 재정의:
1. **헤더 이름이 target field 이름과 정확히 같으면 최우선** (예: 헤더 `source_issue_no` → target `source_issue_no`).
2. `CANONICAL_HEADERS` 매칭.
3. DB 별칭 매칭 — 단 `target = source_issue_no` 에 대한 `"id"` 별칭은 안전장치로 무시.

효과: `Source_issue_no` 헤더가 존재하는 파일에서는 항상 그 컬럼이 선택되고, `ID` 헤더는 UUID 이므로 무시됨.

### 2) 오염 데이터 정리 (DELETE 실행)

이번 실패 임포트로 생성된 UUID-키 44,510행 및 관련 history 삭제:

```sql
DELETE FROM defect_status_history
 WHERE defect_raw_id IN (
   SELECT id FROM defect_items_raw
   WHERE source_issue_no ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 );

DELETE FROM defect_items_raw
 WHERE source_issue_no ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

### 3) 헤더 매핑 정리

`defect_header_mappings`에서 문제의 별칭 제거:

```sql
DELETE FROM defect_header_mappings
 WHERE target_field = 'source_issue_no' AND source_header = 'ID';
```

### 4) 검증

수정 후 v5 파일 재임포트 → **Inserted 0 / Updated 44,510** 이 되는지 확인.
