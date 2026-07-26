## 오류 재현 및 근본 원인

**오류 메시지**
```
null value in column "status_mismatch" of relation "abd_items_raw" violates not-null constraint
```

**진짜 원인 (트리거 로직 결함)**

`abd_items_raw` 스키마:
- `status_mismatch` : `NOT NULL DEFAULT false`
- `latest_status_norm` : **NULLABLE** (누구도 계산해 넣지 않음)

`abd_compute_derived` (BEFORE INSERT/UPDATE 트리거) 마지막 블록:

```sql
IF NEW.latest_status IS NOT NULL
   AND upper(NEW.latest_status) <> COALESCE(NEW.latest_status_norm,'') THEN
  IF NOT (upper(NEW.latest_status) IN ('A','B','C')
          AND NEW.latest_status_norm IN ('A','B','C')) THEN     -- ← 여기 NULL 전파
    NEW.status_mismatch := true;
  ELSE
    NEW.status_mismatch := (upper(NEW.latest_status) <> NEW.latest_status_norm); -- ← 여기서 NULL
  END IF;
ELSE
  NEW.status_mismatch := false;
END IF;
```

`latest_status_norm`이 항상 NULL이므로:
1. `... AND NULL` → NULL, `NOT NULL` → NULL
2. PL/pgSQL `IF NULL THEN` = false → ELSE 분기 실행
3. `upper(...) <> NULL` = **NULL** 이 `status_mismatch`에 대입
4. NOT NULL 제약 위반 → 전체 upsert 실패

업로드하신 HDEC 엑셀에 `latest_status`가 채워진 행이 하나라도 있으면 배치 전체가 실패합니다. 그래서 4,061행 파일과 2,596행 파일 모두 동일 에러가 발생한 것입니다.

**부가 원인**
- `latest_status_norm` 컬럼은 존재하지만 계산 로직이 어디에도 없음(과거 마이그레이션에서 누락됨). Aconex 임포트/대시보드는 이 값을 참조 → 잠재적 오작동 가능.

## 근원적 해결 계획

### 1) 마이그레이션 (`abd_compute_derived` 재작성)

트리거 최상단(is_terminated / Approved 분기보다 앞)에 `latest_status_norm` 정규화 로직을 삽입:

```sql
NEW.latest_status_norm := CASE
  WHEN NEW.latest_status IS NULL OR btrim(NEW.latest_status) = '' THEN NULL
  WHEN upper(btrim(NEW.latest_status)) IN ('A','B','C') THEN upper(btrim(NEW.latest_status))
  ELSE upper(btrim(NEW.latest_status))   -- 원본 유지, 단 대문자화
END;
```

status_mismatch 최종 블록을 NULL-safe 로 교체:

```sql
NEW.status_mismatch := COALESCE(
  NEW.latest_status IS NOT NULL
  AND upper(btrim(NEW.latest_status)) IS DISTINCT FROM COALESCE(NEW.latest_status_norm,''),
  false
);
```

또한 초기 early-return 분기(`is_terminated`, `latest_status_norm='A'`)에도 `NEW.status_mismatch := false;` 명시 추가 → 방어 코드.

### 2) 데이터 정합성 백필

기존 행의 `latest_status_norm` 값을 강제 재계산 (`UPDATE ... SET latest_status = latest_status` 만으로 트리거 재실행). Terminated 행은 제외.

### 3) 검증

- 마이그레이션 후 첨부된 두 HDEC 엑셀(MECH 2,596 / ELEC 4,061)을 재임포트하여 완주 확인
- ABD Dashboard의 status_mismatch attention 리스트가 정상 계산되는지 확인 (기존은 항상 0이었을 가능성)
- `tsgo` 는 스키마만 변경이라 영향 없음, 그래도 실행

## 코드 변경 범위

- **DB 마이그레이션 1건**: `abd_compute_derived` 함수 재작성 + 기존 행 백필 UPDATE
- **애플리케이션 코드 변경 없음** (트리거 결함이므로 파서/업서트 페이로드는 그대로 유지)

## 왜 이 방식이 근원적인가

- 파서/업서트에서 `status_mismatch: false` 를 강제 삽입하는 우회는 트리거가 나중에 다시 NULL 을 넣으므로 무효.
- `latest_status_norm` 을 트리거에서 항상 계산하도록 만들면 `status_mismatch` 계산의 NULL 전파 원인 자체가 사라지고, Aconex diff·대시보드도 정확해집니다.
- NOT NULL 제약을 제거하는 회피안은 다운스트림 통계 SQL(`WHERE status_mismatch`)의 3-값 논리 버그를 유발하므로 채택하지 않음.
