## 목표

각 모듈의 임포트 시, 새 값이 `null`/빈 값이면 **기존 DB 값을 덮어쓰지 않고 유지**. 단, 시스템/자동계산 필드처럼 의도적으로 `null`을 써야 하는 필드는 예외로 강제 기록.

## 기본 규칙

Upsert payload를 만들 때 값이 `null` 또는 `undefined`인 키는 payload에서 **제거**한다. PostgREST upsert는 payload에 없는 컬럼은 update 시 손대지 않으므로 자연스럽게 "기존값 유지"가 된다. insert 신규 행에서는 어차피 컬럼 기본값(대개 null)이 들어가 동작 동일.

예외로 "강제 기록(force)"이 필요한 필드는 화이트리스트로 별도 관리해 `null`이라도 그대로 전달.

## 모듈별 적용 방안

### 1) ABD (`src/lib/abd/mutations.functions.ts` L157-195)
- Payload 빌드 뒤 `stripNullExcept(payload, FORCE)` 헬퍼 적용.
- `FORCE` (null이라도 항상 전송):
  - `team`, `abd_number` (키)
  - `is_active`, `inactive_reason`, `field_mismatch`, `mismatch_fields`
  - `raw_payload`, `source_import_log_id`, `data_date`, `updated_at`, `updated_by`
- 나머지 라운드/문서/PIC 등 값 컬럼은 파일값이 `null`이면 payload에서 제거 → 기존 유지.

### 2) SM / Defect (`src/contexts/DefectManagementImportContext.tsx` L817-957)
- 이미 `put()` 헬퍼가 `excludedFields` 기준으로 제외. 여기에 **"값이 null이면 제외"** 조건 추가:
  ```
  const put = (base, field, value) => {
    if (excludedFields.has(field)) return;
    if (value === null || value === undefined) return; // NEW
    base[field] = value;
  };
  ```
- 단, 아래는 `put`을 우회해 직접 대입하고 있으므로 그대로 유지 (강제 기록):
  - 키/메타: `team`, `data_date`, `source_issue_no`, `raw_payload`, `source_import_log_id`, `updated_by`, `is_active`
  - 파생 강제 로직(`actual_closure_date`, `actual_rectified_date`, `actual_start_date` 자동 채움, `rectified_status='Rectified'` 강제)은 기존 로직 유지 — 새 값이 실제로 존재할 때만 대입.
- `extra` 확장 필드도 동일 규칙(`null`이면 skip) 적용.

### 3) TM (`src/contexts/TaskManagementImportContext.tsx` L675-711)
- Payload 빌드 뒤 `stripNullExcept(payload, FORCE)` 적용.
- `FORCE` (null이라도 항상 전송):
  - 키/식별: `task_no`, `discipline`, `team`, `level`, `main_task_no`
  - **자동계산 리셋 필드**(현행과 동일한 서버 재계산 트리거 유지): `plan_days`, `plan_progress`, `progress_variance`, `slip_days`, `auto_judgment`
  - Main + auto rollup 강제 null: `plan_start`, `plan_end`, `actual_progress` (해당 케이스에서만)
  - 메타: `data_date`, `sort_order`, `source_file`, `imported_at`, `imported_by`
- 나머지 값 컬럼(`category`, `plot`, `task_name`, `risk`, `sub_task_desc`, `hdec_pic_name`, `hdec_eng_name`, `row_type`, `status_manual`, `actual_start`, `forecast_end`, `auto_judgment_import`)은 파일값이 `null`이면 제거 → 기존 유지.

### 4) Spare Part (`src/contexts/SparePartImportContext.tsx` L317-328)
- `...p.struct` 스프레드 대신 struct 순회로 payload 조립하며 `null`/`undefined` 값 제거.
- `FORCE`: `doc_ref` (키), `raw_payload`, `custom_payload`, `updated_by`, `is_active`, `imported_at`. `plot`도 강제 유지(파일 기준값이므로) — 사용자가 원하면 옵션.
- 결과: 사용자가 특정 셀을 비워두면 기존 DB 값이 유지됨.

### 5) DMR (`src/lib/dmr-import.functions.ts` L58)
- 동일 규칙 확장. 기존 필드 구조 확인 후 `null` 제거 + 키/메타만 강제 유지.

## 공용 헬퍼 추가

`src/lib/import/strip-null.ts` (신규):
```ts
export function stripNullExcept<T extends Record<string, unknown>>(
  obj: T,
  force: readonly (keyof T | string)[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  const forceSet = new Set(force as string[]);
  for (const [k, v] of Object.entries(obj)) {
    if (forceSet.has(k)) { out[k] = v; continue; }
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
```

## 부수 고려사항

- **빈 문자열(`""`)**: 파서 대부분이 이미 `""`→`null`로 정규화. 그렇지 않은 곳(있다면)은 파서에서 정리하거나 헬퍼에 `v === ""` 조건 추가 (기본은 `null/undefined`만 스킵).
- **명시적 삭제 UX 없음**: 이 규칙은 "임포트로는 값을 지울 수 없다"를 의미. 수정/삭제는 Raw Data 상세 편집이나 관리자 툴에서 처리. 진행해도 되는지 확인 필요.
- **재임포트(SM Reimport) 흐름**: 기존 잠금(`priority_locked`, `hdec_verification_locked`) 로직은 그대로 유지되며, 새 규칙과 자연스럽게 결합.

## 확인 요청

1. "임포트로는 null 덮어쓰기 불가" 방침이 맞는지 (즉, 셀을 비운 임포트로 기존값 삭제 UX는 포기).
2. TM의 자동계산 필드 5개(`plan_days`, `plan_progress`, `progress_variance`, `slip_days`, `auto_judgment`)는 현행대로 매번 `null`로 강제 초기화 → 서버 재계산. 유지 맞는지.
3. Spare Part의 `plot`은 파일값이 null이면 기존 유지할지, 아니면 강제로 항상 파일값으로 덮을지.

승인 시 위 4개 임포트 컨텍스트/함수와 공용 헬퍼를 단일 커밋으로 수정합니다.