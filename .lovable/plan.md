## 확인된 원인

사용자 말씀대로 Raw Data의 보이는 번호는 모두 맞습니다.

실제 DB 확인 결과:

| task_no | level | main_task_no |
|---|---|---|
| EL-G-29 | main | null |
| EL-G-29-01 | sub | EL-C-29 |
| EL-G-29-02 | sub | EL-C-29 |
| EL-G-29-03 | sub | EL-C-29 |

즉 문제는 **Sub Task No가 틀린 것**이 아니라, 화면에는 보통 보이지 않는 부모 연결키인 **`main_task_no`가 과거 값 `EL-C-29`로 남아있는 것**입니다.

Task Summary는 트리 구조를 만들 때 `sub.main_task_no === main.task_no` 기준으로 하위 태스크를 붙입니다. 그래서 `EL-G-29-xx` 행들은 존재하지만 `main_task_no = EL-C-29`라서 `EL-G-29` 아래에 붙지 못하고, `EL-C-29` Main도 없으므로 Task Summary에서 orphan처럼 빠집니다.

## 화면별 원소스 확인

| 화면 | 데이터 소스 | 현재 판단 |
|---|---|---|
| Raw Data | `task_management_raw` | Raw 행 직접 표시라 정상 노출 |
| Dashboard | `task_management_raw` | 행 단위 집계라 영향 작음 |
| Task Summary | `task_management_raw` | `main_task_no` 기반 트리 구성이라 이번 문제 발생 |
| MWS | `task_management_raw` | 행 단위 조회라 정상 노출 |
| MTWS | `task_management_raw` | MWS와 동일 훅 기반이라 정상 노출 |

결론: 네 화면 모두 Raw Data 테이블을 원소스로 사용하고 있으나, **Task Summary만 계층 연결키 정합성에 의존**합니다.

## 수정 계획

### 1. 기존 EL-G-29 데이터 복구

마이그레이션으로 현재 오염된 연결키를 복구합니다.

```sql
UPDATE task_management_raw
SET main_task_no = 'EL-G-29'
WHERE level = 'sub'
  AND task_no LIKE 'EL-G-29-%'
  AND main_task_no = 'EL-C-29';
```

이후 부모 롤업 재계산을 1회 수행합니다.

```sql
SELECT rollup_task_all_mains();
```

### 2. 재발 방지: Main Task No 변경 시 하위 연결키 자동 동기화

Main Task의 `task_no`가 변경될 때, 기존 `main_task_no = OLD.task_no`였던 Sub Task들의 `main_task_no`를 새 번호로 자동 갱신하는 DB 트리거를 추가합니다.

동작 예:

```text
Main: EL-C-29 → EL-G-29
Sub:  main_task_no EL-C-29 → EL-G-29 자동 변경
```

보이는 Sub Task No는 사용자가 이미 수정할 수 있고, 부모 연결키는 DB가 자동 보정하도록 분리합니다.

### 3. 일반 orphan 데이터도 함께 점검/복구

EL-G-29만 고치는 것이 아니라, 같은 유형의 데이터가 있는지 전체 점검합니다.

복구 기준:

```text
sub.task_no = main.task_no || '-...'
인데 sub.main_task_no != main.task_no 인 경우
```

이 조건에 맞는 경우는 `main_task_no`를 실제 prefix Main Task No로 보정합니다.

### 4. Task Summary 방어 로직 보강

DB 정합성이 원칙이지만, Task Summary에서도 안전망을 추가합니다.

- 우선순위 1: `main_task_no` 기준으로 연결
- 우선순위 2: `main_task_no`가 누락/불일치하고 `task_no` prefix가 존재하는 경우, 화면상에서는 prefix Main 아래로 임시 연결

단, 이 방어 로직은 표시 누락 방지용이며, 실제 데이터 정합성은 DB 트리거/복구가 담당합니다.

### 5. 재계산 최소화 원칙

- Task Summary용 별도 캐시/중복 테이블은 만들지 않음.
- `task_management_raw`를 계속 원소스로 유지.
- Main Task No 변경 시 해당 Main과 관련 Sub만 갱신.
- 전체 롤업은 기존 오염 복구 직후 1회만 수행.
- 이후에는 변경된 그룹만 트리거에 의해 필요한 만큼만 재계산.

## 검증 계획

1. DB에서 `EL-G-29-01/02/03.main_task_no = EL-G-29` 확인.
2. Task Summary에서 `EL-G-29` Main 아래에 Sub 3건이 표시되는지 확인.
3. Raw Data, Dashboard, MWS, MTWS가 모두 `task_management_raw` 기준으로 동일 카운트/판정을 유지하는지 확인.
4. 유사 orphan 조건 조회 결과가 0건인지 확인.