## 목적

Data API 응답 상한(1,000) 관련 조용한 잘림을 함수 단위로 원자적으로 제거한다. **RPC 하나당 DB 마이그레이션 + 호출부 수정 + 타입 재생성을 한 단위로 묶어 배포**하며, 중간 상태에서 앱이 깨지지 않는다.

## 승인된 인벤토리 (요약)

지난 인벤토리 A/B/C/D 표 그대로 확정. 위험 등급 상 항목만 재게시:
- **A4** `abd_items_by_numbers` — 청크 2000 = 상한. Aconex 매칭.
- **A9** `abd_judge_at_date` — 6,688행 전량 반환 사례.
- **A11** `defect_items_search_ids` — `_limit 100000`이 응답 상한을 우회 못 함.
- **A7** `abd_dashboard_attention_lists` — 팀 통합 시 4자리 가능.
- **A5/A15/A16** progress·snag matrix cell RPC — 셀 수 초과 가능.
- **B12** `useCommentInbox` 라벨 조회 `.limit(5000)` — PostgREST 1,000이 먼저 잘림.
- **A10/A18/A20/A22** 경계 RPC — 성장 시 잘림.

## 수정 원칙 (사용자 지시 반영)

1. **원자 배포**: RPC 함수 하나 = (DB 마이그레이션 + 호출부 수정 + 타입 재생성) 한 커밋. R1/R2 분리 금지.
2. **금지 규칙 정밀화**:
   - **단발 대량 조회**: 청크 < 응답 상한(즉 청크 ≤ 999). 청크 == 상한 패턴 금지.
   - **offset 루프**: 청크 1,000 허용. 단 `offset += rows.length` (반환 rows 실측 기반). `offset += CHUNK` 금지 (마지막 페이지에서 skip 발생).
   - 종료 조건: `rows.length === 0` 또는 `rows.length < CHUNK`.
   - 안전선(iteration 상한, `+ N` 안전값)은 로그와 함께 유지.
3. **`assertNoTruncation` 이원화**:
   ```ts
   // src/lib/import/assertNoSilentTruncation.ts
   export function assertNoTruncation(src: string, rows: unknown[], total?: number | null) {
     if (typeof total !== "number" || rows.length >= total) return;
     const msg = `[silent-truncation] ${src}: ${rows.length}/${total} — 다음 페이지 미요청`;
     if (import.meta.env.DEV) throw new Error(msg);
     console.error(msg);
   }
   ```
   - dev = 즉시 throw (개발 중 인지 강제)
   - prod = `console.error` (사용자 화면 붕괴 방지, 관측만)
4. **jsonb 반환은 필요 컬럼만**. 특히 A9는 판정에 실제 사용하는 컬럼만 포함해 payload 축소.

## 실측 정정

- **ABD Raw Data MECH 탭 pageSize=ALL 2,606건**이 사용자 실측 대상. Defect `Mechanical Services` 15,784건은 **추가 스트레스 테스트**로 유지.
- 각 라운드 완료 시 두 실측을 병행 수행하고 결과를 라운드 산출물로 보고.

---

## 라운드 (함수 단위 원자 배포)

각 라운드 = 1 마이그레이션 + 관련 호출부 수정 + 타입 재생성 + 실측. 마이그레이션 승인 후 코드 편집 진행. 라운드 사이에 앱은 항상 정상 동작.

### 라운드 1 — `abd_items_by_numbers` (A4)

- DB: `returns jsonb`로 재정의. `coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)`. 필드는 호출부(`computePatch`) 실사용 26개 유지. 함수 상단 주석: 반환 계약, 중복 abd_number = 첫 건 채택.
- 코드: `src/lib/abd/aconex-import.functions.ts` — `if (!Array.isArray(data)) throw ...`, 중복 첫 건 채택 주석, 청크 크기·주석 정비.
- 타입 재생성.
- 실측: Plot C 3,359 → matched ≈ 2,915, Plot D 3,483 → matched ≈ 3,160. 2,000 고정 소멸 확인.

### 라운드 2 — ABD Raw Data ALL 전량 실측 및 방어 강화 (A1)

- DB 변경 없음 (`abd_items_search`는 row-per-record + total_count 표준안이 이미 적용).
- 코드: `useAbdItems` 청크 루프의 `offset` 전진을 `CHUNK` → 실제 `batch.length` 기반으로 교체. `assertNoTruncation("abd_items_search", collected, total)`을 최종 수집 후 호출.
- 실측: **ABD Raw Data MECH 탭, pageSize=ALL → 2,606건 전량 로드 + Export 2,606행 확인**.

### 라운드 3 — `abd_judge_at_date` (A9)

- DB: `returns jsonb`. 반환 필드는 판정에 실제 사용되는 최소셋(`id, active_round, current_stage, delay_bucket, ur_aging_days, bucket_top`) 유지. 그 외 열은 컬럼 축소해 payload 감소.
- 코드: 호출부(대시보드·딥링크·MWS 판정) 전량 shape 검증 도입 + rows.length 기반 offset 필요 시 range 루프.
- 실측: 팀 전체(6,688건) 판정 리스트 1회 요청에서 잘림 없음.

### 라운드 4 — `defect_items_search_ids` (A11)

- DB: `returns jsonb`(id 배열). `_limit` 파라미터 유지(성능 안전선 목적).
- 코드: 호출부 shape 검증. Bulk edit 대량 선택에서 실제 id 개수가 `_limit` 근처면 `assertNoTruncation` 발동.
- 실측: Defect 필터 조합에서 결과 수 ≥ 1,001 케이스 재현 후 전량 반환 확인.

### 라운드 5 — `abd_dashboard_attention_lists` (A7)

- DB: `returns jsonb`. 필드는 UI 소비 그대로.
- 코드: 대시보드 소비부 shape 검증.
- 실측: 팀 전체 attention 리스트가 잘림 없이 렌더링.

### 라운드 6 — Progress/Snag matrix cell RPC (A5/A15/A16)

- DB: `abd_progress_cells`, `defect_snag_progress_cells`, `defect_snag_progress_totals`, `defect_snag_dashboard_matrix`를 `returns jsonb`(cells 배열)로 재정의.
- 코드: 각 소비 hook(`useSnagDashboardMatrix` 등) shape 검증 + row-mapping 유지.
- 실측: 대시보드/Progress 셀 수가 1,000 초과되는 조합(팀 전체 × 전 라운드 × 월 단위)에서 렌더링·집계 일치.

### 라운드 7 — `useCommentInbox` 라벨 조회 (B12)

- 코드: `.limit(5000)` 제거 → `.range()` 명시 루프. 종료 조건은 `batch.length < CHUNK`. `assertNoTruncation` 호출.
- 실측: Defect 인박스에서 5,001건 이상 존재 시 전량 라벨 매핑 확인.

### 라운드 8 — 경계 RPC 표준화 (A10/A18/A20/A22)

- `defect_items_search`(ALL), `sm_my_workspace_rows`, `tm_today_actual`, `tm_judge_at_date` 호출부에 offset-loop 표준안(공용 헬퍼 `paginateRpc`)을 적용. DB 변경은 각 함수 응답이 실제로 1,001 이상 가능한 경우에만 라운드 편입.
- 실측: TM 총 1,431건 판정/오늘 실적이 잘림 없이 반환.

### 라운드 9 — ST Raw Data 조사·표준화

- `SparePartRawDataPage.tsx:265`의 `.from("spare_parts_raw").select(...)` 실사용 확인. range/limit 부재 시 range 루프로 교체. 현재 총 98건이라 즉시 위험은 낮으나 표준안 적용으로 미래 성장 대비.

## 공통 산출물

- `src/lib/import/assertNoSilentTruncation.ts` 신설(dev throw / prod error).
- `src/lib/data/paginateRpc.ts`(또는 유사 위치) 신설 — `offset += rows.length` 기반 표준 루프 헬퍼. 호출부 순차 이관.
- 각 라운드 완료 시 실측 결과 표를 남긴다:
  - ABD MECH ALL/Export 2,606건 재확인
  - Defect Mechanical Services 15,784건 스트레스
  - 라운드별 대상 RPC의 대표 케이스

## 실패 시 롤백

각 라운드는 마이그레이션 1개 + 코드 1개 커밋으로 좁게 유지 → 문제 발생 시 해당 라운드만 롤백. 이전 라운드는 독립적으로 정상 상태.