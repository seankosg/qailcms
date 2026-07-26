
## 목표

Aconex 임포트에서 `semantic === "EXCLUDED_TERMINATED"`(Review Status = Terminated) 또는 `EXCLUDED_CANCELLED` 감지 시, **현재 라운드(R{n})의 Submission을 취소하고 재제출 대기 상태**로 되돌린다. DS/DF는 해당 라운드에서 필요 없으므로 자동으로 완료 처리한다. 임포트 결과 화면에 **Termination 리셋된 도면 리스트**를 노출한다.

## 용어 정리

- **UR (Under Review)**: Submission이 완료되어 DAR 검토 중인 상태.
- **Termination**: HDEC이 Submission을 withdraw한 상태 → 동일 라운드에서 재제출 필요.

## 변경 대상

1. `src/lib/abd/aconex-import.functions.ts` — `computePatch()` Termination 분기 재작성 + preview/apply 결과에 `terminated_reset` 리스트 포함.
2. `src/components/abd/import/AconexImportPanel.tsx` (또는 결과 표시 컴포넌트) — 임포트 완료 후 리셋된 도면 목록 카드 렌더.

## 신규 로직 — Termination/Cancelled 분기

기존:
```ts
if (semantic === "EXCLUDED_TERMINATED" || semantic === "EXCLUDED_CANCELLED") {
  patch.is_terminated = true;
  patch.latest_status = r.status_code ?? r.status_raw ?? null;
  return patch;
}
```

신규:
1. **활성 라운드 n 결정**: 기존 로직과 동일하게 `existing.active_round` 우선, 없으면 히스토리로 추론.
2. **Submission/DAR/Response 리셋** (해당 라운드만):
   - `r{n}_submission_actual = null`
   - `r{n}_dar_actual = null`
   - `r{n}_response_result = null`
3. **DS/DF 자동 완료 채움** (비어있을 때만, 기존 actual 보존):
   - `r{n}_ds_actual`가 null → `iso ?? existing[\`r${n}_ds_plan\`] ?? null`
   - `r{n}_df_actual`가 null → `iso ?? existing[\`r${n}_df_plan\`] ?? null`
   - `iso`는 Aconex `date_modified`. 둘 다 없으면 null 유지.
4. **상태 필드**:
   - `is_terminated = false` (재제출 대기, 통계 포함)
   - `latest_status = null` (Submission 전 상태로 회귀)
5. **active_round 유지** — 동일 라운드 재사용.

## 리셋 결과 표시

### 서버 (aconex-import.functions.ts)
- preview/apply 응답 스키마에 `terminated_reset: Array<{ document_no, round, prev_submission_actual, prev_response_result, date_modified }>` 추가.
- `computePatch` 호출 시점에 Termination 분기에서 리셋 대상 정보를 수집(별도 콜렉터 배열).
- preview 단계: 감지된 목록만 반환(변경 미적용). apply 단계: 실제 반영된 목록 반환.

### 클라이언트
- 임포트 결과 카드(요약: 신규/업데이트/스킵 옆) 하단에 **"Termination 리셋 (n건)"** 섹션 추가.
- 접이식 리스트: `Document No · R{n} · 이전 Submission 날짜 → 리셋` 한 줄씩.
- 아이콘/색상은 기존 zinc(TERMINATED) 배지 팔레트 재사용.

## 하위 파급

- `abd_compute_derived` 트리거가 자동 재계산 — 마이그레이션 불필요.
- 대시보드 KPI/Attention/Progress Matrix에서 재제출 대기 항목으로 자연 노출.
- 과거에 `is_terminated = true`로 마킹된 데이터는 다음 임포트에서 자연 정정 (backfill 스크립트 없음).

## 스코프 밖

- Preview 단계 사용자 승인 게이트 — 즉시 리셋.
- 이력 archive 테이블에 별도 로그 — `abd_change_log` 기존 트리거로 커버.

## 검증

- Termination 포함 샘플 파일 임포트 → 결과 카드에 리셋 리스트 노출 확인.
- DB 조회로 `r{n}_submission_actual = null`, `r{n}_ds_actual` 채움, `is_terminated = false`, `latest_status = null` 확인.
- Attention Inbox에서 해당 도면이 재제출 대기로 나타나는지 확인.
