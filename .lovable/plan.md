## 사용자 확정 사항 (업데이트 반영)

1. **SM 모듈 전체에서 "completion" → "rectified"/"rectification" 로 일괄 변경** — 라벨뿐 아니라 **필드명, DB 컬럼명, 파생 함수명, 상수명, URL 파라미터명** 까지. 원본 status에는 "Rectified"만 존재.
2. 기존 DB `completion_status = 'Complete'` 행을 `'Rectified'` 로 일괄 백필.
3. **Rectified 진입 시 자동 채움**: `actual_rectified_date` 를 `last_updated_at` 로 채우고, `actual_start_date` 가 비어있으면 그것도 같은 값으로 채움.
4. **Closed ⇒ Rectified 완료 반영**: `closure_status = 'Closed'` 이면 `rectified_status` 도 `'Rectified'`. Closed 진입 시 `actual_closure_date` 뿐 아니라 `actual_rectified_date` 도 비어있으면 `last_updated_at` 로 채움 (인과 반영). Start도 비어있으면 동일하게 채움.
5. **Re-Opened**: 신규 컬럼 추가하지 않음. 이미 dashboard(`dashboard-shape.ts`) 가 `status_raw` 로 "Re-Opened" 를 `reopen` 버킷에 별도 카운트하고 있어 충분. 다만 `deriveRectifiedStatus` 에서는 "reopened" 를 **Open과 동일하게 `Not Started` 로 취급**(기존 "In Progress" 매핑 수정). Dashboard 의 reopen 카운트는 `status_raw` 만 사용하므로 영향 없음.

## 리네이밍 매핑

### DB 컬럼 (defect_items_raw)
| 기존 | 신규 |
|---|---|
| `completion_status` | `rectified_status` |
| `planned_completion_date` | `planned_rectified_date` |
| `actual_completion_date` | `actual_rectified_date` |

### TypeScript / 상수 / 함수명
- `COMPLETION_STATUSES` → `RECTIFIED_STATUSES = ["Not Started", "In Progress", "Rectified"]`
- `deriveCompletionStatus` → `deriveRectifiedStatus`
- Stage 키 `"completion"` → `"rectified"` (Stage 타입, progress RPC 파라미터, URL search 파라미터, `isStageDone` 인자, `stageView` 기본값 등)
- `isActualComplete` → `isRectified`
- URL search 파라미터: `actualComplete` → `actualRectified`
- Progress URL `stageView` 기본 문자열: `"start,completion,closure"` → `"start,rectified,closure"`

### 화면 문구
남아있는 "Completion"/"Comp"/"Completed" 표시 문구를 모두 `"Rectified"` / `"Rect"` 로 통일.

## 구현 단계

### 1. Migration — 스키마 리네이밍 + 데이터 백필
```sql
ALTER TABLE public.defect_items_raw RENAME COLUMN completion_status TO rectified_status;
ALTER TABLE public.defect_items_raw RENAME COLUMN planned_completion_date TO planned_rectified_date;
ALTER TABLE public.defect_items_raw RENAME COLUMN actual_completion_date TO actual_rectified_date;
UPDATE public.defect_items_raw SET rectified_status = 'Rectified' WHERE rectified_status = 'Complete';
```
- `defect_field_config`, `defect_header_mappings` 에서 `completion_status` / `planned_completion_date` / `actual_completion_date` 를 참조하는 row 가 있으면 field_key/target_field 값 UPDATE (사전 SELECT로 존재 여부 확인 후).
- Progress 관련 서버 RPC (`progress.functions.ts` 에서 호출) 의 SQL 정의도 새 컬럼명으로 갱신.
- `supabase/types.ts` 는 자동 재생성.

### 2. 파생 로직 (`src/lib/defect-management/derived.ts`)
- `deriveRectifiedStatus(statusRaw)`:
  - `rectified`, `closed`, `verified` → `"Rectified"`
  - `in progress`, `inprogress`, `under review` → `"In Progress"`
  - `open`, `new`, `re-opened`, `reopened`, `""`, `null`, 기타 → `"Not Started"`
- `deriveClosureStatus`: 변동 없음.

### 3. 임포트 Context (`src/contexts/DefectManagementImportContext.tsx`)
전이 시점의 자동 날짜 채움 로직 재작성. `lastUpd = p.last_updated_at?.slice(0,10) ?? dataDate`. excludedFields 존중.

- **Rectified 진입** (`newRS === "Rectified"` AND `prevRS !== "Rectified"`):
  - `actual_rectified_date` 비어있으면 `lastUpd` 로 채움.
  - `actual_start_date` 비어있으면 `lastUpd` 로 채움.
- **In Progress 진입** (`newRS === "In Progress"` AND `prevRS !== "In Progress"` AND `prevRS !== "Rectified"`):
  - `actual_start_date` 비어있으면 `lastUpd` 로 채움.
- **Closed 진입** (`newCloSt === "Closed"` AND `prevCloSt !== "Closed"`):
  - `actual_closure_date` 비어있으면 `lastUpd` 로 채움.
  - `actual_rectified_date` 비어있으면 `lastUpd` 로 채움 (인과 반영).
  - `actual_start_date` 비어있으면 `lastUpd` 로 채움.
  - `rectified_status` 를 `"Rectified"` 로 반영 (derive 결과에서 이미 처리되지만 안전망).
- **Re-Opened 진입**: 기존 actual dates 는 보존. `rectified_status` 는 `"Not Started"` 로 되돌아감. dashboard 의 reopen 카운트는 `status_raw` 로 자동 반영.

### 4. 코드 전면 리네이밍
`rg` 로 모든 참조 찾아 정확한 식별자 단위로 치환:
- `src/lib/defect-management/`: `columns.ts`, `derived.ts`, `stage-utils.ts`, `filter-fns.ts`, `parser.ts`, `mutations.functions.ts`, `progress.functions.ts`, `progress-utils.ts`, `export-meta.ts`, `dashboard-shape.ts`, `bulk-actions.ts`
- `src/components/defect-management/`: raw-data 전체, progress (SnagProgressPage, SnagScheduleMatrix), dashboard (DeSnagMatrixBlock, DeSnagStatusCell, DeSnagGrandTotalCards, DeSnagRoomGroupCards, DeSnagDashboardPage), detail (DefectDetailPage), import (DefectColumnSelect, DefectManagementImportPage, DuplicateReviewDialog)
- `src/contexts/DefectManagementImportContext.tsx`
- `src/hooks/`: `useDefectFieldConfig.ts`, `useDefectItems.ts`, `useSnagDashboardMatrix.ts`
- `src/routes/_authenticated/closure/snag-management/`: `raw-data.tsx`, `progress.tsx`

### 5. 검증
- 빌드/TypeScript strict 통과.
- Raw Data / Progress / Dashboard 페이지 정상 렌더.
- 샘플 임포트로 4가지 전이 (→In Progress / →Rectified / →Closed / →Re-Opened) 자동 채움 검증.
- `rg -i "completion" src/` 로 잔존 심볼 확인 (주석/문서 최소한만 허용).

## 완료 기준

- `completion` 어휘가 DB 컬럼/필드/함수/URL/화면에서 모두 `rectified`/`rectification` 로 변경.
- `Complete → Rectified` DB 백필 완료.
- Closed ⇒ Rectified 자동 반영 (파생·전이 양쪽에서 보장).
- Rectified 진입 시 actual_start_date 도 비어있으면 함께 채움.
- Closed 진입 시 rectified/start actual date 도 비어있으면 채움.
- Re-Opened 별도 카운트는 기존 dashboard 로직 그대로 유지 (신규 컬럼 없음).
- 빌드/lint 통과.
