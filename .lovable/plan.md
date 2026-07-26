# ABD Revise(계획수정필요) 자동 판정 + 초안 계획 생성

## 목적
Response 실적일이 다음 라운드 DS Plan을 넘긴 경우 → 계획이 이미 비현실적. 자동 감지하고 사용자가 원클릭으로 초안 계획을 DB에 반영.

## 판정 규칙 (트리거 `abd_compute_derived`)

Latest Status = A → 무시(종결).  
그 외 각 라운드 N ∈ {1, 2}에 대해:

```
IF rN_dar_actual IS NOT NULL
   AND r(N+1)_draft_start_plan IS NOT NULL
   AND rN_dar_actual > r(N+1)_draft_start_plan THEN
  needs_revise := true
  delay_bucket += 'Revise'
END IF
```

- 컬럼 신설: `needs_revise boolean DEFAULT false`, `revise_source_round smallint` (1 또는 2 — 어느 라운드의 Response가 초과 원인인지)
- 기존 `needs_planning`(NoPlan)과는 별개 플래그로 관리

## 초안 계획 생성 규칙

Revise 대상에 대해, 원인 라운드 N의 Response Actual 다음날(도하 기준)을 새 DS로 잡고, 기존 다음 라운드 계획 간격을 그대로 유지:

```
old_ds = r(N+1)_draft_start_plan
old_df = r(N+1)_draft_finish_plan
old_sb = r(N+1)_submission_plan
old_rs = r(N+1)_dar_plan   (없으면 유지 NULL)

gap_df = old_df - old_ds     (일수)
gap_sb = old_sb - old_ds
gap_rs = old_rs - old_ds     (nullable)

new_ds = rN_dar_actual + 1일
new_df = new_ds + gap_df
new_sb = new_ds + gap_sb
new_rs = new_ds + gap_rs     (nullable)
```

- 기존 간격 계산에 필요한 값이 NULL이면 해당 필드는 유지 (덮어쓰지 않음)
- 반영은 `r(N+1)_draft_start_plan/finish_plan/submission_plan/dar_plan` 4개 컬럼만 UPDATE
- 트리거가 자동 재계산 → `needs_revise` 자동 해제

## UI

### Attention Inbox (`src/components/attention/AttentionInbox.tsx`)
- 새 탭 **"계획수정필요(Revise)"** 추가 (기존 NoPlan 탭과 별개)
- 각 행에 **"계획생성"** 버튼 노출

### 계획생성 다이얼로그 (신규 `AbdReviseDraftDialog.tsx`)
- Before/After 표 (DS/DF/SB/RS Plan 현재값 vs 초안값)
- 사용자가 4개 날짜 필드를 수동 조정 가능
- [적용] → `abd_items_raw` UPDATE + `abd_change_log` 기록
- [일괄 적용] 지원 (필터된 Revise 목록 전체를 초안 그대로 반영)

### Raw Data 배지
- Latest Status/Bucket 컬럼 옆에 노란색 **REVISE** 배지 (기존 컬러 뱃지 시스템 활용)

### Dashboard
- 지연 KPI 카드 줄에 **"Revise Needed"** 카드 추가 (팀별 MECH/ELEC breakdown 포함, 기존 KPI 카드 패턴과 동일)

## 서버 함수

`src/lib/abd/revise.functions.ts` (신규, `requireSupabaseAuth`):
- `computeReviseDraft(itemId)` → 초안 4개 날짜 반환 (미리보기용)
- `applyReviseDraft(itemId, { r_ds, r_df, r_sb, r_rs })` → UPDATE 실행 + 변경로그
- `bulkApplyReviseDraft(itemIds[])` → 배치 적용 (배치 크기 200, 트랜잭션 단위)

RPC 확장:
- `abd_items_search` 필터 파라미터에 `_revise_only boolean` 추가 (Attention Inbox 리스트용)
- `abd_dashboard_row2` 반환에 `revise_total`, `revise_by_team` 추가

## 마이그레이션

1. `ALTER TABLE abd_items_raw ADD COLUMN needs_revise boolean DEFAULT false, ADD COLUMN revise_source_round smallint;`
2. `abd_compute_derived` 함수 교체 (Revise 로직 추가)
3. 인덱스: `CREATE INDEX idx_abd_needs_revise ON abd_items_raw(needs_revise) WHERE needs_revise = true;`
4. 전체 재계산: `UPDATE abd_items_raw SET updated_at = updated_at;`
5. RPC 함수 3종 갱신 (`abd_items_search`, `abd_dashboard_row2`)

## 완료 기준
- Revise 대상이 Attention Inbox의 새 탭에 나열됨
- "계획생성" 버튼으로 초안 미리보기 → 적용 → 트리거가 자동으로 `needs_revise` 해제
- 대시보드 Revise KPI 카드 정확한 카운트
- Raw Data에 REVISE 뱃지 표시