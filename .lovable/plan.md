## B-0b. 날짜 위생 전수 조사 결과 (조치 없음, 사실만)

측정: `task_management_raw where is_active`, 범위 밖 = `< 2020-01-01 OR > 2035-12-31`

### B-0b-1. 필드별 범위 밖 값 전수 (총 5건 / 3개 행)

| 필드 | 건수 | Task No | 값 |
|---|---|---|---|
| plan_start | 0 | — | — |
| plan_end | 1 | EL-D-21-02 | 1902-07-18 |
| actual_start | 0 | — | — |
| actual_finish | 2 | EL-D-29 / EL-D-29-01 | 1902-03-28 (각각) |
| forecast_end | 2 | EL-D-29 / EL-D-29-01 | 1902-03-28 (각각) |

### B-0b-2. F 보정 근거
`actual_finish IS NOT NULL` 총 297건 중 범위 밖 = **2건** (EL-D-29, EL-D-29-01).
→ 오손 제외 시 유효 완료 = **295건**. (B-1 검증점에서는 지시대로 보정하지 않고 297로 대조)

### B-0b-3. 오손 행 전체 상태

| task_no | level | plan_start | plan_end | actual_start | actual_finish | actual_progress | forecast_end | data_date | source_file | imported_at |
|---|---|---|---|---|---|---|---|---|---|---|
| EL-D-29 | main | 2026-07-12 | 2026-07-17 | 2026-07-06 | 1902-03-28 | 1.0000 | 1902-03-28 | 2026-07-21 | Task Management_전기_260721.xlsx | 2026-07-21 15:44:55+00 |
| EL-D-29-01 | sub | 2026-07-12 | 2026-07-17 | 2026-07-06 | 1902-03-28 | 1.0000 | 1902-03-28 | 2026-07-21 | Task Management_전기_260721.xlsx | 2026-07-21 15:44:55+00 |
| EL-D-21-02 | sub | 2026-08-20 | 1902-07-18 | (null) | (null) | 0.0000 | (null) | 2026-08-01 | Task Management_전기_260801_신민호.xlsx | 2026-08-01 15:07:55+00 |

`status_history` actual_finish 변경 이력 (source 전부 `manual`, 임포트 아님):

| changed_at (UTC) | task_no | old → new |
|---|---|---|
| 2026-07-20 10:38:00 | EL-D-29-01 | null → 1902-03-28 |
| 2026-07-20 10:38:00 | EL-D-29 | null → 1902-03-28 |
| 2026-07-20 13:09:23 | EL-D-29 | 1902-03-28 → null, null → 1902-03-28 |
| 2026-07-20 13:11:16 | EL-D-29 | 1902-03-28 → null, null → 1902-03-28 |
| 2026-07-20 13:20:56 | EL-D-29 / EL-D-29-01 | 1902-03-28 → 1902-03-29 |
| 2026-07-21 15:17:01 | EL-D-29 | 1902-03-29 → null / EL-D-29-01 1902-03-29 → 1902-03-28 |
| 2026-07-22 06:24:52 | EL-D-29 | null → 1902-03-28 |

→ 1902 최초 유입은 **2026-07-20 10:38 수동(manual) 편집**이며, 그 전 값은 **null**. 즉 엑셀 시리얼 임포트 오손이 아니라 **화면 수동 입력 오손**이다. (1902-03-28 ≈ 엑셀 1900 체계 serial 800 대응 형태 → 날짜 입력창에 숫자를 넣은 것으로 추정, 미확정)

### B-0b-4. 원본 파일 코호트

| source_file | 행수 | 범위 밖 plan_end | 범위 밖 actual_finish | 범위 밖 forecast_end |
|---|---|---|---|---|
| Task Management_전기_260721.xlsx | 53 | 0 | 2 | 2 |
| Task Management_전기_260801_신민호.xlsx | 102 | 1 | 0 | 0 |

→ 특정 열에 몰린 임포트 오손 아님. 산발적 수동 입력 2건 + 신규 1건(EL-D-21-02, plan_end).
EL-D-21-02 는 임포트 파일 유래이므로 원본 셀 확인이 별도로 필요(처방 대기).

---

## B-1. 완료 정본 단일화 — 코드/SQL 교체 (데이터 무변경)

### grep 실측 목록 (OR 결합 및 progress-only 완료 분기)

클라이언트:
- `src/lib/task-management/derived.ts:121` — `if (actual >= 1 || row.actual_finish) return "완료";`
- `src/lib/task-management/derived.ts:277` — `getStageJudgment` 내 `if (actual >= 1) return "완료";`
- `src/lib/task-management/derived.ts:303` — `computeJudgment` 내 `if (actual >= 1) return "완료";`
- `src/hooks/useMyWorkspaceData.ts:69` — `Number(r.actual_progress ?? 0) >= 1 || !!r.actual_finish`

DB (정의 실측 확인 완료):
- `tm_kpi_judgment_g` — `WHEN (COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL) THEN '완료'`
- `tm_kpi_bucket_matches_g` — `SELECT (COALESCE(_actual_progress,0) >= 1 OR _actual_finish IS NOT NULL) AS is_completed`
- `tm_items_counts` — 동일 `is_completed` 정의
- `tm_items_counts_by_team` — 동일 `is_completed` 정의
- `v_task_management_raw_derived` — `plan_overdue`, `actual_overdue` 두 CASE 의 `(COALESCE(t.actual_progress,0) >= 1 OR t.actual_finish IS NOT NULL)`
- `update_task_summary` — `bool_and(actual_finish is not null or least(1,greatest(0,coalesce(actual_progress,0))) >= 1) as all_finished`

참고(교체 대상 아님, 완료 판정이 아니라 진도 기반 계산): `tm_compute_derived`(delay/expected 계산), `tm_expected_finish`(예측 종료일 계산), `tm_judge_at_date`(hist_actual 기반 과거 시점 계산), `tm_rows_as_of`(stage_finish 표시). → 이들 중 완료 판정 의미로 쓰이는 부분이 발견되면 착수 시 보고 후 처리.

### 시행 순서
1. 클라이언트 4개 지점 교체 (`actual_finish` 존재 단독).
2. 마이그레이션 1건으로 DB 6개 대상 `CREATE OR REPLACE` (시그니처 변경 없음 → DROP 불필요).
3. 고정 검증점: as-of = 도하 오늘 기준 `완료 = 297`. 불일치 시 즉시 중단·보고.
4. 5분류 실측 재집계 후 α/β 실제 배분값 보고 (임의 수정 금지).

### 확인 필요 1건
`derived.ts:277 / 303` 의 progress-only 완료 분기는 지시문 ①(121행)에 명시되지 않았습니다. 다만 이를 남기면 N 12건(progress≥1 · finish null)이 클라이언트 판정에서 여전히 '완료'로 남아 서버(297)와 어긋납니다. **정본 단일화 취지에 따라 함께 교체하는 것으로 진행**하되, 유지를 원하시면 알려주십시오.
