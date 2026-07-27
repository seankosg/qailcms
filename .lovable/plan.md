## 최종 플랜 — 실측 검증 반영

두 Aconex 실파일(Plot_D-2, -3) 확인 결과 `is_excluded=true` 223건이 모두 두 semantic 중 하나로 분류됨을 확인. 폴백은 방어 코드로만 유지.

## 배지 변경

| 현재 | 변경 후 | 조건 |
|---|---|---|
| `matched N` | `matched N` (유지) | `existingRows.has(document_no)` |
| `unmatched N` | **`unmatched_not exist DB N`** | `!existingRows.has(document_no)` |
| `excluded N` (합쳐진 값) | **`Terminated-round reset N`** | `semantic === "EXCLUDED_TERMINATED"` (N>0일 때만) |
| — | **`Cancelled-excluded N`** | `semantic === "EXCLUDED_CANCELLED"` (N>0일 때만) |
| — | `other-excluded N` (폴백) | `is_excluded && semantic ∉ {두 값}` (N>0일 때만 노출, 회색) |

불변식: `terminated_reset_count + cancelled_excluded_count + other_excluded_count === 기존 excluded`. 실측에서는 항상 `other=0`.

## 변경 파일

### 1) `src/lib/abd/aconex-import.functions.ts`
- `AconexImportPreview` 타입에 3개 필드 추가:
  ```ts
  terminated_reset_count: number;
  cancelled_excluded_count: number;
  other_excluded_count: number;
  ```
- 기존 `excluded: number` 는 하위호환 유지(=세 값의 합).
- line 119 근처에 집계 추가:
  ```ts
  const terminated_reset_count = data.rows.filter(r => r.semantic === "EXCLUDED_TERMINATED").length;
  const cancelled_excluded_count = data.rows.filter(r => r.semantic === "EXCLUDED_CANCELLED").length;
  const other_excluded_count = excludedCount - terminated_reset_count - cancelled_excluded_count;
  ```
- preview 반환 객체에 위 3개 필드 포함.

### 2) `src/components/abd/import/AbdAconexImportPage.tsx`
- **line 430**: `unmatched {e.preview.unmatched}` → `unmatched_not exist DB {e.preview.unmatched}`
- **line 432-435** (기존 `excluded` 배지): 삭제하고 3개 조건부 배지로 교체:
  ```tsx
  {e.preview.terminated_reset_count > 0 && (
    <span title="Review Status=Terminated — 해당 라운드 Submission/DAR/Response 리셋 후 재제출 대기">
      Terminated-round reset {e.preview.terminated_reset_count}
    </span>
  )}
  {e.preview.cancelled_excluded_count > 0 && (
    <span title="Status=Cancelled — 통계에서 제외">
      Cancelled-excluded {e.preview.cancelled_excluded_count}
    </span>
  )}
  {e.preview.other_excluded_count > 0 && (
    <span title="예외 케이스 — 원본 status/review 조합 확인 필요" className="회색">
      other-excluded {e.preview.other_excluded_count}
    </span>
  )}
  ```
- **line 482**: 하단 상세 패널 헤더 `Termination 리셋 ({n}건)` → `Terminated-round reset ({n}건)` 로 문구만 정렬. (목록은 `terminated_reset` 배열 그대로 — 각 행에 semantic 컬럼이 이미 노출됨)
- 기존 4개 옵셔널 툴팁(matched/unmatched_not exist DB 포함)도 함께 부착.

### 3) 하위호환 배려
- `preview.excluded` (합계) 필드는 유지 → 기존 소비자(있다면) 안전.
- 로그 `note` 문구는 변경 안 함 (matched/unmatched 만 사용, excluded 는 언급 안 함).

## 범위 밖 (건드리지 않음)
- 파서(`aconex-parser.ts`), semantic 판정, apply 로직, 라운드 리셋 처리
- HDEC 임포트 UI
- Raw Data 페이지의 `excludedCount` (별도 필터 컨셉 — 무관)
- DMR 임포트 페이지의 `excludedCount` (헤더 선택 컨셉 — 무관)
- DB 스키마

## 검증
1. `bun run typecheck` (자동).
2. 두 Plot D 파일 프리뷰 → `Terminated-round reset 221 · Cancelled-excluded 2` 로 표시, `other-excluded` 미노출 확인.
3. 하단 패널 헤더 문구 확인.
