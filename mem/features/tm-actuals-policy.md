---
name: TM 실적 체계 정책 (2026-08-03 종결)
description: TM 모듈의 As-of 예외 원칙, 완료 정본(actual_finish 단독), 기준일 기본값(어제), 게이트 등식 방법론
type: feature
---
## TM 실적 체계 확정 정책 (2026-08-03 종결)

- **TM은 전사 As-of 정책의 명시적 예외.** 판단 기준: 측정치에 사건일이 붙어 있는가.
  - 이산 사건 + 사건일 보유 → as-of 재구성이 사실 (ABD·SM·SPL·WRT)
  - 연속 관측 + 사건일 없음 → 추정 (TM). status_history의 changed_at 은 입력 시각이지 진척 시점이 아니므로 as-of 재구성 금지.
- **기준일 무관 불변**: Actual %, actual_start, actual_finish, 완료 판정.
  **기준일 함수**: Plan % 와 파생(gap·판정·지연일수). 판정 보류·중립 없음.
- **완료 정본 = `actual_finish` 단독.** progress=1 은 트리거가 finish 를 채우는 경로일 뿐, 판정은 finish 만 읽는다.
- **기준일(Cutoff) 기본값 = 어제** (`sessionStorage` KEY `tm_cutoff`). tm_kpi_tplan 의 `(as_of − plan_start) + 1` 이 착수 첫날 하루치를 요구하는 편향을 상쇄. Primavera P6 Data Date 개념.
- **actual_duration 은 미완료 시 NULL.** 시간의 함수를 스냅샷으로 저장 금지.
- **actual_finish_source**: `user`/`import` = 정본, `auto`/`forecast`/`migration` = "완료일 미확인" 배지 대상. 문구는 "'예상 완료' 열에서 들어온 값입니다. 확인해 주세요" (잘못된 값이라 단정하지 않음). C4 제약: `CHECK (actual_finish IS NOT NULL OR actual_finish_source IS NULL)`.
- **진도율 곡선 = 2점 직선**: 시작 앵커 actual_start(없으면 plan_start) v=0 → 끝 앵커 actual_finish v=1, 없으면 `COALESCE(progress_observed_at, data_date)` 에서 v=진도율. status_history 참조 금지.
- **상세 페이지 포함 모든 TM 화면은 정본(tm_rows_as_of / tm_kpi_judgment_g) 경유.** `task_management_raw` 직조회 후 클라 재계산 금지.

## 검증 방법론 (필수)

- **게이트는 상수가 아니라 등식으로 건다.** `합 = count(*)`, `완료 = count(actual_finish NOT NULL) = tm_items_counts = 화면 배지`. 절대 수치 게이트는 모집단이 변하면 무효.
- **"변동 0"·"회귀 없음"은 검증이 아니다.** 결함이 드러날 수 없는 조건에서 잰 0 은 통과가 아니다.
- **"0건"에는 반드시 모집단을 붙인다.** "곡선 763건 중 위반 0" ≠ "위반 0".
- 측정 대상을 먼저 확인한다(잘못된 대상의 실측은 무효). 호출부의 인자 전달까지 봐야 함수 동작을 판단할 수 있다.
- 신설 컬럼은 "누가 언제 쓰는가"를 함께 지정한다(컬럼만 만들고 안 쓰는 결함은 조용히 통과).
- 덮어쓰기·삭제는 반드시 화면에 보이게 한다.
- React Query `queryKey` 에 배열 길이만 담지 말 것 — 정렬된 id 결정적 해시(`rowIdsSig`) 사용.

## 근본 원인 (대외 과제)

HDEC 마스터 엑셀 양식에 실제 완료일 열이 없어 작성자들이 '예상 완료' 열에 실제 완료일을 기입해 왔다(ARCH 만 r4 주석 존재, MECH·ELEC 없음). **HDEC 마스터 엑셀 실제 완료 열 신설이 백로그 최우선·대외 요청 항목.**