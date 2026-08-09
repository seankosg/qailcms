# SM 6단계 스테이지 재설계 제안

## 요약
SM(Snag Management)의 진행 단계를 기존 3단계(Start → Rectified/Completion → Closure)에서 6단계로 확장·정리합니다.

```text
Start → Rectified → Pre-Inspection → DAR-Inspection → Closure → H/O
```

기존 `Completion`은 `Rectified`와 동의어로 통합·폐기합니다.

## 변경 범위
- DB: `defect_items_raw`에 신규 단계별 날짜 컬럼 추가
- DB 함수: `_snag_stage_planned_date`, `_snag_stage_actual_date`, `_snag_stage_done` 수정
- 파서: `src/lib/defect-management/parser.ts` 매핑 대상/Canonical 이름 정리
- UI: Raw Data 컬럼, Progress Matrix, Dashboard 지표, 필터
- 임포트/백필: 단계별 실적 입력 규칙 및 가드
- 데이터 마이그레이션: 기존 `actual_rectified_date` → 새 단계로의 매핑 정책

## 1. 단계 정의

| 단계 | DB stage key | 계획 컬럼 | 실적 컬럼 | 의미 |
|------|--------------|-----------|-----------|------|
| Start | `start` | `planned_start_date` | `actual_start_date` | 항목 착수 / 작업 개시 |
| Rectified | `rectified` | `planned_rectified_date` | `actual_rectified_date` | 조치(보완) 완료 |
| Pre-Inspection | `pre_inspection` | `planned_pre_inspection_date` | `actual_pre_inspection_date` | 사전 검수(Pre-Inspection) |
| DAR-Inspection | `dar_inspection` | `planned_dar_inspection_date` | `actual_dar_inspection_date` | DAR 검수 |
| Closure | `closure` | `planned_closure_date` | `actual_closure_date` | 공식 클로저 |
| H/O | `ho` | `planned_ho_date` | `actual_ho_date` | Hand Over 완료 |

- `completion` stage key는 `rectified`로 병합. 기존 데이터와 함수는 `rectified`를 사용하도록 일원화.
- 약어: `Pr-Ins` = `pre_inspection`, `Dr-Ins` = `dar_inspection`, `HO` = `ho`.

## 2. DB 스키마 변경

### 2.1 `defect_items_raw`에 추가할 컬럼

```sql
ALTER TABLE public.defect_items_raw
  ADD COLUMN planned_pre_inspection_date date,
  ADD COLUMN actual_pre_inspection_date date,
  ADD COLUMN planned_dar_inspection_date date,
  ADD COLUMN actual_dar_inspection_date date,
  ADD COLUMN planned_ho_date date,
  ADD COLUMN actual_ho_date date;
```

### 2.2 기존 컬럼 정리

- `planned_rectified_date`, `actual_rectified_date`는 유지(Rectified 단계로 사용).
- `completion` key를 참조하는 기존 코드/뷰/함수를 `rectified`로 마이그레이션.

### 2.3 단계 함수 교체

`_snag_stage_planned_date`, `_snag_stage_actual_date`, `_snag_stage_done`을 6단계로 재작성.

```sql
CREATE OR REPLACE FUNCTION public._snag_stage_planned_date(_row defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'start'            THEN _row.planned_start_date
    WHEN 'rectified'        THEN _row.planned_rectified_date
    WHEN 'pre_inspection'   THEN _row.planned_pre_inspection_date
    WHEN 'dar_inspection'   THEN _row.planned_dar_inspection_date
    WHEN 'closure'          THEN _row.planned_closure_date
    WHEN 'ho'               THEN _row.planned_ho_date
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_actual_date(_row defect_items_raw, _stage text)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'start'            THEN _row.actual_start_date
    WHEN 'rectified'        THEN _row.actual_rectified_date
    WHEN 'pre_inspection'   THEN _row.actual_pre_inspection_date
    WHEN 'dar_inspection'   THEN _row.actual_dar_inspection_date
    WHEN 'closure'          THEN _row.actual_closure_date
    WHEN 'ho'               THEN _row.actual_ho_date
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._snag_stage_done(_row defect_items_raw, _stage text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _stage
    WHEN 'ho'               THEN _row.actual_ho_date IS NOT NULL
    WHEN 'closure'          THEN _row.actual_closure_date IS NOT NULL OR _row.actual_ho_date IS NOT NULL
    WHEN 'dar_inspection'   THEN _row.actual_dar_inspection_date IS NOT NULL OR _row.actual_closure_date IS NOT NULL OR _row.actual_ho_date IS NOT NULL
    WHEN 'pre_inspection'   THEN _row.actual_pre_inspection_date IS NOT NULL OR _row.actual_dar_inspection_date IS NOT NULL OR _row.actual_closure_date IS NOT NULL OR _row.actual_ho_date IS NOT NULL
    WHEN 'rectified'        THEN _row.actual_rectified_date IS NOT NULL OR _row.actual_pre_inspection_date IS NOT NULL OR _row.actual_dar_inspection_date IS NOT NULL OR _row.actual_closure_date IS NOT NULL OR _row.actual_ho_date IS NOT NULL
    WHEN 'start'            THEN _row.actual_start_date IS NOT NULL OR _row.actual_rectified_date IS NOT NULL OR _row.actual_pre_inspection_date IS NOT NULL OR _row.actual_dar_inspection_date IS NOT NULL OR _row.actual_closure_date IS NOT NULL OR _row.actual_ho_date IS NOT NULL
    ELSE false
  END
$$;
```

> 참고: `_snag_stage_done`의 "이후 단계 실적이 있으면 본 단계도 완료" 규칙은 기존 로직을 유지합니다.

## 3. 파서/매핑 변경

### 3.1 Canonical 헤더 → field key

```text
Planned Pre-Inspection Date  -> planned_pre_inspection_date
Actual Pre-Inspection Date   -> actual_pre_inspection_date
Planned DAR Inspection Date  -> planned_dar_inspection_date
Actual DAR Inspection Date   -> actual_dar_inspection_date
Planned H/O Date             -> planned_ho_date
Actual H/O Date              -> actual_ho_date
Planned Hand Over Date       -> planned_ho_date
Actual Hand Over Date        -> actual_ho_date
Planned HO Date              -> planned_ho_date
Actual HO Date               -> actual_ho_date
```

### 3.2 `EXTRA_REIMPORT_FIELDS` 재구성

- `planned_pre_inspection_date`, `actual_pre_inspection_date`, `planned_dar_inspection_date`, `actual_dar_inspection_date`, `planned_ho_date`, `actual_ho_date` 추가.
- 기존 `planned_H/O_date`, `actual_H/O_date` 등 하이픈/슬래시 버전은 canonical 정규화를 통해 위 key로 수렴.

## 4. 확정된 설계 결정 (사용자 확인 완료)

1. **H/O 단계 의미** — Closure 이후의 **최종 Hand Over**. Closure와 별개 시점이며 마지막 단계.
2. **Pre-Inspection / DAR-Inspection Owner** — **HDEC PIC**. 두 단계의 실적 입력·수정 권한은 HDEC PIC(및 상위 관리자)로 제한.
3. **Completion → Rectified 병합** — UI 문구를 전부 `Rectified`로 통일. 실측 결과 SM 컴포넌트의 사용자 노출 문구는 이미 "Rectified"이며, 남은 것은 DB 함수 3종의 `'completion'` stage key alias 제거뿐이다.
4. **기존 데이터 백필** — 아래 4.2 규칙에 따름.

### 4.1 현재 데이터 실측 (`defect_items_raw`)

| 구분 | 행수 |
|------|------|
| 전체 | 119,432 |
| `actual_rectified_date` 있음 | 77,981 |
| `actual_rectified_date` + `actual_closure_date` 모두 있음 | 68,976 |
| `actual_rectified_date` 있고 `actual_closure_date` 없음 | 9,005 |
| `actual_closure_date` 있음 (전체) | 70,364 |

### 4.2 백필 규칙 (확정)

**규칙 A — Closure 실적이 있는 행 (70,364건)**

Pre-Inspection·DAR-Inspection을 **자동 완료**로 간주하고, 계획일·실적일 **4개 컬럼 모두 `actual_closure_date`와 동일한 값**으로 백필한다.

```sql
UPDATE public.defect_items_raw
SET planned_pre_inspection_date  = actual_closure_date,
    actual_pre_inspection_date   = actual_closure_date,
    planned_dar_inspection_date  = actual_closure_date,
    actual_dar_inspection_date   = actual_closure_date
WHERE actual_closure_date IS NOT NULL
  AND actual_pre_inspection_date IS NULL
  AND actual_dar_inspection_date IS NULL;
```

- H/O 단계는 **백필하지 않는다**. 이 행들의 잔여 작업은 Hand Over 단계로 남는다.
- 되돌리기 대비 백필 스냅샷 테이블(`defect_stage_backfill_snapshot_<YYYYMMDD>`)에 대상 `id` 목록을 저장한다.

**규칙 B — Closure 실적이 없는 행 (rectified만 있는 9,005건 포함)**

- 자동 완료로 보지 **않는다**. Pre-Inspection / DAR-Inspection / H/O 계획·실적 모두 `NULL` 유지.
- 코드 구현 완료 후 **임포트를 통해 계획일을 입력**할 예정.

## 5. 임포트/백필 가드

### 5.1 단계별 순차 완료 규칙

- 후속 단계 실적이 있으면 선행 단계는 자동 완료(`_snag_stage_done` 규칙).
- 단, 선행 단계 계획일이 없는 상태에서 후속 단계 실적만 입력하는 것은 허용(계획일 누락 가능).
- 실적 삭제 시 후속 단계 실적이 있으면 선행 단계 삭제 불가(가드).

### 5.2 권한 가드 (Pre-Inspection / DAR-Inspection)

- 두 단계의 실적일(`actual_pre_inspection_date`, `actual_dar_inspection_date`) 쓰기는 **HDEC PIC** 소유.
- 판정 근거는 역할 이름 하드코딩이 아니라 `rcl_grants(모듈, 액션)` 경로를 사용하며, 행의 `hdec_pic_name` 일치 여부를 함께 검사한다.
- 계획일(`planned_*`)은 임포트/관리자 경로로 입력한다.
- 거부된 쓰기는 사유별로 집계해 화면과 임포트 로그 양쪽에 남긴다.

### 5.3 임포트 파일

- 재수출 파일에서 6단계 계획/실적 12개 컬럼 모두 수신 가능.
- 헤더는 추정하지 않는다. 매핑이 부족하면 `/admin/mapping` 별칭으로 해결하고, 미매핑 컬럼은 임포트에서 제외한 뒤 사용자 승인 절차를 거친다.

## 6. UI 영향

### 6.1 Raw Data

- `defect_field_config`를 통해 6단계 컬럼 노출/순서/고정 설정.
- Raw Data 테이블에 6단계 계획/실적 컬럼 추가(12개 컬럼 증가).
- Sticky 컬럼 배경 불투명 규칙 유지.

### 6.2 Stage Progress Pip

`src/components/defect-management/raw-data/DefectStageProgress.tsx`의 `StageName`을 6단계로 확장하고 Pip 3개 → 6개로 변경. Legend 문구도 `Start → Rectified → Pr-Ins → Dr-Ins → Closure → H/O`로 갱신.

### 6.3 Progress Matrix

- SM Progress Matrix의 열을 6단계로 교체.
- `progress.tsx` 라우트의 `stageView` 기본값(`"start,rectified"`)과 허용 값 확장. 각 단계별 Done % 집계.
- 팀/빌딩/룸 그룹별 drill-down 유지.

### 6.4 Dashboard

- KPI 카드: Start, Rectified, Pr-Ins, Dr-Ins, Closure, H/O 각 단계별 완료/미완료/지연.
- Overdue 계산: 각 단계별 planned vs actual 비교.
- 합계 = 모집단 검산: 분포·도넛·스택 차트는 미분류 버킷을 명시적으로 만들어 총합이 대상 행 수와 일치하는지 검증.

### 6.5 필터

- 단계 필터를 6단계로 확장(`raw-data.tsx`의 `stage`, `remaining_stage`, `noPlanStages` 파라미터).
- 지연 기준: `asOf > planned_date && actual_date IS NULL`.

## 7. 영향 파일 목록(예상)

- `src/lib/defect-management/stage-utils.ts` — `StageName` 3→6, `isStageDone` / `isStageDelayedAsOf` / `classifyDefectStage` 확장
- `src/components/defect-management/raw-data/DefectStageProgress.tsx` — Pip 6개
- `src/lib/defect-management/parser.ts` — canonical 헤더 + `EXTRA_REIMPORT_FIELDS`
- `src/lib/defect-management/columns.ts` 및 필드 설정
- SM Progress Matrix / Dashboard 컴포넌트
- `src/routes/_authenticated/closure/snag-management/progress.tsx`, `raw-data.tsx` — search schema
- DB 마이그레이션: `defect_items_raw` 컬럼 6개 추가 + `_snag_stage_*` 함수 3종 교체
- DB 함수: `_snag_done_asof`, `snag_progress_events`, 대시보드/매트릭스 RPC의 stage 목록

## 8. 실행 순서

1. 마이그레이션 1 — 컬럼 6개 추가
2. 마이그레이션 2 — `_snag_stage_*` 함수 3종 6단계로 교체 (`'completion'` alias 제거)
3. 마이그레이션 3 — 백필 스냅샷 테이블 생성 + 규칙 A 백필 (멱등 `WHERE` 조건 포함)
4. 파서 / 컬럼 / stage-utils 코드 수정
5. Raw Data · Progress Matrix · Dashboard UI 반영
6. Pre-Ins / Dr-Ins 쓰기 권한 가드 적용
7. 실측 검증 — 백필 대상 건수 대조, 단계별 done 카운트 항등식, 합계 = 모집단 검산
