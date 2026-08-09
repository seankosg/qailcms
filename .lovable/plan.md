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

## 4. 데이터 마이그레이션 정책

### 4.1 기존 데이터

- `completion` key를 사용한 기존 뷰/함수/코드는 모두 `rectified`로 교체.
- `actual_rectified_date`가 있는 항목은 Rectified 단계 완료로 간주. Pre-Inspection/DAR-Inspection 날짜는 비워 둠.
- H/O 날짜는 기존에 없으므로 `closure` 이후 단계로 별도 채워 넣어야 함.

### 4.2 임포트/백필 시 매핑

- 파일에서 `Planned Pre-Inspection Date` 등이 있으면 해당 컬럼에 직접 매핑.
- 파일에서 `Completion Date` 등 레거시 헤더가 있으면 `Rectified`로 별칭 처리(하위 호환).

## 5. 임포트/백필 가드

### 5.1 단계별 순차 완료 규칙

- 후속 단계 실적이 있으면 선행 단계는 자동 완료(`_snag_stage_done` 규칙).
- 단, 선행 단계 계획일이 없는 상태에서 후속 단계 실적만 입력하는 것은 허용(계획일 누락 가능).
- 실적 삭제 시 후속 단계 실적이 있으면 선행 단계 삭제 불가(가드).

### 5.2 Aconex / 재수출 파일

- Aconex 임포트는 `Closure`, `H/O` 등의 UPDATE만 수행. 행 생성 없음.
- 재수출 파일에서 6단계 날짜 모두 수신 가능.

## 6. UI 영향

### 6.1 Raw Data

- `defect_field_config`를 통해 6단계 컬럼 노출/순서/고정 설정.
- Raw Data 테이블에 6단계 계획/실적 컬럼 추가(12개 컬럼 증가).
- Sticky 컬럼 배경 불투명 규칙 유지.

### 6.2 Progress Matrix

- SM Progress Matrix의 열을 6단계로 교체.
- 각 단계별 Done % 집계.
- 팀/빌딩/룸 그룹별 drill-down 유지.

### 6.3 Dashboard

- KPI 카드: Start, Rectified, Pre-Ins, DAR-Ins, Closure, H/O 각 단계별 완료/미완료/지연.
- Overdue 계산: 각 단계별 planned vs actual 비교.
- Milestone Timeline(Outstanding Work)에 6단계 추가 반영.

### 6.4 필터

- 단계 필터: 6단계 드롭다운.
- 지연 기준: 현재 시점 > planned_date && actual_date IS NULL.

## 7. 영향 파일 목록(예상)

- `src/lib/defect-management/parser.ts`
- `src/lib/defect-management/columns.ts` 및 필드 설정
- `src/lib/defect-management/derived.ts` 또는 유사 판정 로직
- SM Progress Matrix 컴포넌트
- SM Dashboard 카드/차트
- SM Raw Data 테이블
- DB 마이그레이션: `defect_items_raw` 컬럼 추가 + 함수 교체
- DB 함수: `_snag_stage_*`, `_snag_done_asof`, `_snag_progress_norm` 등

## 8. 결정 필요 사항

1. **H/O 단계의 의미**: Closure 이후 최종 Hand Over인가, 아니면 Closure와 동일한 시점인가?
2. **Pre-Inspection/DAR-Inspection의 Owner**: HDEC, PM/PD, Subcontractor 중 누가 실적 입력 권한을 가지는가?
3. **Completion→Rectified 병합**: 기존 "Completion"이라는 UI 문구를 "Rectified"로 일괄 교체할 것인가?
4. **기존 데이터 백필**: `actual_rectified_date`가 있는 항목을 Pre-Inspection/DAR-Inspection도 자동 완료로 볼 것인가, 아니면 비워 둘 것인가?

## 9. 다음 단계

사용자 승인 후 코드 수정 및 마이그레이션을 시작합니다.
