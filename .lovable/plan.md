# ABD 모듈 전면 재수립 — 최종 계획 (v5, 승인 대기)

## 0. v5 변경 요약 (이번 회차 추가)

**Aconex 임포트 경로 신설.** 기존 임포트는 HDEC 파일 전용으로 유지하고, Aconex 파일은 별도 파서·업서트 경로로 처리한다. 필드는 소스별로 3그룹(Aconex / HDEC / System)으로 개념 분리한다.

## 0-1. 필드 소스 분류 (신설 개념)

| 그룹 | 정의 | 예시 |
|---|---|---|
| HDEC | 기존 임포트로 채우는 필드 (계획·실적·팀 등 대부분) | rX_draft/submission plan·actual, batch_no, hdec_pic 등 |
| Aconex | Aconex 파일에서만 채우는 필드 (덮어쓰기 우선) | `latest_status_norm`(A/B/C), 최신 라운드 `rX_response_actual`, `aconex_review_status`, `aconex_status_raw`, `aconex_date_modified`, `is_terminated` |
| System | 트리거/파생 | `current_stage`, `bucket_top`, `delay_bucket`, `active_round`, `needs_planning`, `rs_result_missing` 등 |

- `abd_field_config`에 `source_group ∈ {hdec, aconex, system}` 컬럼 추가 → Admin Field Config에 뱃지 표시.
- Admin Header Mapping은 기존 HDEC 탭 + **Aconex 탭 신설** (source_header → target_field 4개 고정).

## 0-2. Aconex 임포트 로직 (신설)

### 파일 자동 판별 (fingerprint)
`module-fingerprint.ts`에 Aconex 룰 추가: 헤더에 `Document No` + `Status` + `Review Status` + `Date Modified` 4종이 모두 존재하면 `abd-aconex`. 없으면 기존 `abd-hdec`. 불명확 시 `ModuleGuardDialog`로 사용자 확인.

### 파서 (`src/lib/abd/aconex-parser.ts` 신설)
파일에서 다음 4컬럼만 읽는다.
- `Document No` → 매칭 키 (기존 `abd_number`와 정규화 비교; suffix `_R1/_R2` 등이 붙는 경우 제거 후 매칭)
- `Status` (원본 raw)
- `Review Status` (원본 raw)
- `Date Modified` → `dohaDateOnly` 적용

### 상태 정규화 (SSOT: `src/lib/abd/aconex-status.ts`)

**Status 컬럼 처리**
| Status 원문 | 동작 |
|---|---|
| `A` / Approved | `latest_status_norm='A'` + 활성 라운드 `rX_response_actual = Date Modified` (덮어쓰기) |
| `B` / Approved with Comment | 동일 (`'B'`) |
| `C` / Revise and Resubmit | 동일 (`'C'`) |
| `Cancelled` | `is_active=false`, `is_terminated=true`, `latest_status_norm='TERM'` (표시용 "Terminated") — 전체 통계에서 제외 |
| `For Review` / `Submitted for Review` | **무동작** (HDEC 값 우선) |
| 기타 | 무동작 + 임포트 로그에 warning |

**Review Status 컬럼 처리** (Status 처리 후 적용, Review Status가 명시된 경우 우선)
| Review Status 원문 | 동작 |
|---|---|
| `A` / Approved | `latest_status_norm='A'` + `rX_response_actual = Date Modified` |
| `B` / Approved with Comment | `'B'` 동일 |
| `C` / Revise and Resubmit | `'C'` 동일 |
| `Cancellation Accepted` / `Terminated` | `is_active=false`, `is_terminated=true`, `latest_status_norm='TERM'` — 전체 통계에서 제외 |
| 기타 | 무동작 |

### 활성 라운드 결정
`active_round` = 현재 `SB(n)_actual`이 있고 `RS(n)_actual`이 없는 최대 n (없으면 `SB_actual`이 있는 최대 n). Aconex Response Actual은 이 라운드의 `rN_response_actual`에 기록. R3 이후 케이스는 `extra_rounds JSONB`에 append + Attention 리스트 노출.

### 우선순위 규칙 (충돌 시)
- `latest_status_norm`, `rX_response_actual`, `is_active/is_terminated`: **Aconex > HDEC > 기존 DB값** (Aconex 파일 임포트 시 무조건 덮어쓰기)
- 그 외 모든 필드: HDEC 규칙 유지

### 임포트 로그
- `abd_import_logs.source_kind ∈ {'hdec','aconex'}` 컬럼 추가
- 행 단위 로그: `updated_status`, `updated_response_actual`, `terminated`, `no_action`(For Review 등), `skipped_no_match`
- 롤백: 기존 `rollback_abd_import` RPC에서 Aconex 로그도 대상. 롤백 시 `abd_change_log`의 이전값으로 복원.

### 통계·대시보드 반영
- 전체 도면 카운트, Row1/Row2/모든 KPI에서 `is_terminated=true OR is_active=false` 제외 (기본 필터에 이미 `is_active=true`가 있으므로 자연 제외).
- Raw Data 표에서는 `is_active=false`도 별도 토글로 볼 수 있게 유지하고, Latest Status 컬럼은 `TERM → "Terminated"` 뱃지로 표시.

### UI 진입점
`ImportHubPage`의 ABD 탭에 **파일 종류 자동 감지 배지** + 수동 강제 선택 라디오(`HDEC / Aconex`) 추가. Fingerprint 결과와 사용자 선택이 다르면 `ModuleGuardDialog`로 재확인.

## 0-3. Enum·스키마 확장 (v4 마이그레이션에 추가)

```sql
ALTER TABLE abd_items_raw
  ADD COLUMN aconex_status_raw TEXT,
  ADD COLUMN aconex_review_status_raw TEXT,
  ADD COLUMN aconex_date_modified DATE,
  ADD COLUMN aconex_last_synced_at TIMESTAMPTZ,
  ADD COLUMN is_terminated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN extra_rounds JSONB;

ALTER TABLE abd_import_logs
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'hdec';  -- 'hdec' | 'aconex'

ALTER TABLE abd_field_config
  ADD COLUMN source_group TEXT NOT NULL DEFAULT 'hdec'; -- 'hdec'|'aconex'|'system'
```

- `latest_status_norm` 도메인에 `'TERM'` 값 허용.
- 트리거 `abd_compute_derived`: `is_terminated=true`면 `bucket_top=NULL`, `delay_bucket='{}'`로 세팅해 전 KPI에서 자연 제외.

## 0-4. v4 계획과의 상호작용

- Row1 배타 5카드: `is_active=true AND is_terminated=false` 데이터로 집계 (합=전체 유지).
- Row2 지연 판정: 동일 필터.
- Attention Tabs에 **"Aconex Terminated"**, **"Aconex Extra Rounds (R4+)"** 신규 탭 추가.
- Progress Page: Aconex로 채워진 Response Actual도 동일하게 표시 (소스 아이콘으로 구분).

---

## 1~9. v4의 기존 항목 (변경 없음, 요약)

- Terminology 동결 (§1)
- Row1 배타 5분류 SSOT (§2)
- Row2 지연 판정 4항목 + 총합 (§3)
- 대시보드 Row1~6 레이아웃 (§4)
- `AbdKpiCard` 컴포넌트 스펙 (§5)
- 스키마·트리거·`abd_settings`·RPC 7종 (§6) — 위 §0-3 컬럼 병합
- 파서 개편 (§7) — HDEC 파서 + Aconex 파서 병존
- Progress Page / Raw Data 최소 스코프 (§8)
- 진행 순서 (§9) — 아래 §10으로 갱신

## 10. 진행 순서 (v5 갱신)

1. Migration 1 — v4 컬럼 + §0-3 Aconex 컬럼 + `abd_settings` + 트리거
2. Header Mapping 시드 (HDEC 팀별 + **Aconex 4컬럼**) · Field Config 시드 (`source_group` 포함)
3. HDEC 파서 개편 (DS/DF 분리 + RS Result + `dohaDateOnly` + `batch_no`)
4. **Aconex 파서 · 정규화 SSOT · fingerprint 규칙**
5. **Import 경로 분기** (`ImportHubPage` + `AbdImportPage` + `ModuleGuardDialog`)
6. SSOT TS 유틸 (`stage-logic.ts`, `status-normalize.ts`)
7. RPC 7종 (§6.4)
8. `AbdKpiCard` 신규 컴포넌트
9. Dashboard 전면 재작성 (Row1~6, `is_terminated` 제외 포함)
10. UR Aging ⚙️ Popover + `saveAbdThresholds`
11. Progress Page — 판정 로직만 SSOT로 이관
12. Raw Data — 신규 컬럼/뱃지(Terminated·Aconex 아이콘)/권한
13. Admin Field Config / Header Mapping — Aconex 탭·source_group 뱃지
14. 회귀 검증
    - `PLOT_D_ELEC_ABD` HDEC 재임포트 → Row1 합=전체
    - `Plot_D_ABD_1_Aconex.xlsx` Aconex 임포트 → A/B/C 덮어쓰기, Cancelled/Terminated 제외 확인
15. Migration 2 (지연) — 구 `rX_drafting_plan/actual` DROP
