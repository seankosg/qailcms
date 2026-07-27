## 병목 진단 (실측 근거)

`src/lib/abd/aconex-import.functions.ts` 를 라인 단위로 감사한 결과, 겉으로 "무한 진행"으로 보이는 원인은 **Cloudflare Worker의 subrequest 한도 & 순차 라운드트립 폭증** 두 가지의 합작입니다.

| # | 위치 | 실측 | 요청 수 (matched=2,915 기준) |
|---|---|---|---|
| ① | L127–141 `abd_items_by_numbers` RPC | 800개 청크 루프 | 약 5회 |
| ② | **L249–298 개별 UPDATE 루프** | `for (const d of diffs) { await supa.from("abd_items_raw").update(patch).eq("abd_number", ...) }` — 매 diff마다 한 번씩 순차 UPDATE | **약 2,915회** |
| ③ | L301 `flushFieldLogs` (백그라운드) | 500개 청크 INSERT, 하지만 매 diff마다 unchanged 필드 포함 로그 축적 → 수천~수만 행 | 수십 회 |
| ④ | 최종 `abd_import_logs` UPDATE | 1회 | 1 |

합계 ≈ **3,000+ 서브요청**. Cloudflare Worker(nodejs_compat) subrequest 한도는 workers.dev 기본 50, 유료 플랜 1,000 — 어떤 조건에서도 이 규모는 위험합니다. 실제 관찰된 현상(응답이 안 오고 "무한" 대기 → 새로고침하면 어느새 완료됨)은 subrequest 한도/서버 응답 타임아웃의 전형적 증상입니다. 클라이언트는 응답이 안 오는 동안 `await` 만 걸어두고 스피너를 돌리므로 "무한처럼 보임".

**핵심 결론:** 진도바를 붙여도 subrequest 폭증 자체가 안 풀리면 결국 실패합니다. 우선 요청 수를 O(N)에서 **O(chunks)**로 축소해야 합니다.

---

## 최적화 전략 — 요청 수를 3,000회 → 10회 미만으로

### 1) 개별 UPDATE 루프 → **단일 벌크 RPC로 치환** (가장 큰 효과)

신규 DB 함수 `abd_aconex_apply_diffs(_batch_id uuid, _patches jsonb)` 를 도입.

```
UPDATE abd_items_raw t
SET  latest_status         = COALESCE((p->>'latest_status'), t.latest_status),
     latest_rev            = COALESCE((p->>'latest_rev'), t.latest_rev),
     approval_date         = COALESCE(NULLIF(p->>'approval_date','')::date, t.approval_date),
     aconex_status_raw     = COALESCE(p->>'aconex_status_raw', t.aconex_status_raw),
     aconex_review_status_raw = COALESCE(p->>'aconex_review_status_raw', t.aconex_review_status_raw),
     aconex_date_modified  = COALESCE(NULLIF(p->>'aconex_date_modified','')::timestamptz, t.aconex_date_modified),
     round_actual          = COALESCE((p->>'round_actual')::int, t.round_actual),
     is_terminated         = COALESCE((p->>'is_terminated')::bool, t.is_terminated),
     aconex_last_synced_at = now(),
     source_import_log_id  = _batch_id,
     updated_at            = now(),
     updated_by            = auth.uid()
FROM   jsonb_array_elements(_patches) AS p
WHERE  t.abd_number = p->>'document_no';
```

- 라운드트립: 2,915 → **1회**. (또는 안전 마진으로 1,000건 청크 3회 분할)
- 트랜잭션 원자성 확보 (기존은 부분 실패 시 절반만 반영됨).
- 반환값: `updated int` — 서버 함수는 그대로 `updated` 카운트에 사용.

### 2) `flushFieldLogs` 볼륨 축소

- 현재 L282–297 `changes.length === 0` 인 경우에도 `latest_status` unchanged 로그를 남김 → matched의 대부분이 unchanged라 로그 수천 건 발생.
- 조치: **unchanged 로그 기록을 제거**. Aconex 임포트의 감사 목적은 "실제 변경"이면 충분. `abd_change_log` 트리거가 이미 존재하므로 unchanged 라인을 별도 남길 필요 없음.
- applied 로그는 유지하되, 파일당 필드 변경이 통상 수백 건 이내로 축소됨.

### 3) `abd_items_by_numbers` 청크 크기 확대

- 현재 800 청크 5회 → 필요 컬럼만 반환하는 현행 RPC로 응답이 이미 가벼움. 청크를 **2,000**으로 늘려 3,000건짜리 파일에서 라운드트립을 2→1회로 축소. (Postgres jsonb 파라미터로 문서번호 전달 → URL 길이 이슈 없음)
- 안전 상한 20,000 유지 (RowSchema 최대치와 동일).

### 4) `abd_import_logs` 이중 UPDATE 제거

- L231 INSERT("in_progress") → L305 UPDATE("success") 두 번의 라운드트립을 한 번의 INSERT("success", updated=?)로 병합. 단, 실패 흔적을 위해 실패 케이스에서만 UPDATE("failed") 남기도록 조정.

### 5) `flushFieldLogs`는 계속 백그라운드로 유지 + 실패 관용

- 이미 `void ... .catch(...)` 로 응답 지연에 영향 없음 → 유지.
- 다만 field_log INSERT 청크가 subrequest 한도를 잠식하지 않도록 청크 크기를 500 → **1,000**으로 상향, 총 INSERT 횟수 절반으로.

---

## 예상 효과 (matched=2,915 파일 기준)

| 항목 | 현재 | 개선 후 |
|---|---:|---:|
| 매칭 조회 RPC | 5회 | 1~2회 |
| 데이터 UPDATE | **2,915회** | **1~3회** |
| import_logs 로그 | 2회 | 1회 |
| field_log INSERT | ~20회 | ~5회 |
| **총 subrequest** | **~3,000+** | **~10** |
| 체감 소요 시간 | 수십 초~ 미완료 | 수 초 |

subrequest 한도(50/1,000)와 무관한 안전 마진 확보. "무한 진행" 착시 자체가 사라짐.

---

## 구현 순서 (build 모드 진입 후)

1. **Migration** — `abd_aconex_apply_diffs(uuid, jsonb) returns int` 함수 생성 + GRANT EXECUTE TO authenticated. `SECURITY DEFINER` + `SET search_path = public`. 함수 본문에서 `has_role(auth.uid(), 'admin')` OR `has_role(..., 'superuser')` 를 명시적으로 재검증.
2. **`aconex-import.functions.ts` 수정**
   - L127–141: 청크 크기 800 → 2,000.
   - L249–298: 개별 UPDATE 루프 제거 → `supa.rpc("abd_aconex_apply_diffs", { _batch_id, _patches })` 1회(또는 1,000 청크). 반환값을 `updated`로 사용.
   - L282–297: unchanged latest_status 로그 삽입 블록 삭제.
   - L231/L305: `in_progress` → `success` 병합 (실패 경로에서만 별도 UPDATE("failed") 유지).
3. **`flushFieldLogs`**: 청크 크기 500 → 1,000 (해당 유틸의 기본값만 조정).
4. **회귀 QA**
   - 소형 파일 (100행 이하) 임포트 → 기존과 동일한 변경 반영/카운트.
   - 대형 파일(3,000+행) 임포트 → 수 초 내 완료, `abd_change_log` 트리거로 변경 이력 정상 기록.
   - Termination/Cancelled → `round_actual` 리셋 정상.
   - 서버 로그(`stack_modern--server-function-logs`)에 subrequest 관련 경고 없는지 확인.

---

## 명시적 비-목표

- 진행률 UI 는 이번 범위 밖. 벌크화로 실제 완료가 수 초 단위로 떨어지면 스피너만으로 충분.
- HDEC 임포트 흐름, TM/SM/DMR 임포트, 정합성 로직 무변경.
- 취소/롤백 UI 무변경(기존 `rollback_abd_import` RPC 유지).
