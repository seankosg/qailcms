## 원인 분석 (DB 확인 결과)

`task_management_raw` 실제 값:
- `AR-C-T-01-01` → `actual_progress = 1.0000`, `auto_judgment = '완료'`, `level = 'sub'`

즉 데이터는 완료 상태입니다. 문제는 UI 렌더링 조건에 있습니다.

## TMRD(`TaskManagementRawDataPage.tsx` 1155–1197 라인)의 결함

```ts
const ap = Number((row.original as any).actual_progress ?? 0);
const aj = (row.original as any).auto_judgment_value;   // ← 잘못된 필드명
const isDone = ap >= 1 || aj === "완료";
```

1. **필드명 오타**: DB/스키마에는 `auto_judgment` 컬럼만 존재하고 `auto_judgment_value`는 없음. 따라서 OR 폴백이 항상 `false`. 이 잔재는 이전 대시보드 판정 시스템 개편 때 남은 것.
2. **`actual_progress`가 PostgREST에서 문자열("1.0000")로 반환**될 수 있고, `Number("1.0000") >= 1`은 true지만 부동소수 라운딩 케이스(0.9999…)도 있음 → 임계값을 `>= 0.999`로 완화.
3. **시각적 강도 부족**: 완료행에 `opacity-60`만 적용 → sticky 컬럼(고정 컬럼 100% 불투명 규칙)과 겹치면 상대적으로 흐림이 약해 보임. ABDRD는 `bg-muted/40 text-muted-foreground/70`로 배경까지 회색화하여 훨씬 명확히 회색으로 보임.

## 수정 내용

### 파일: `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`

1. `isDone` 판정 수정 (라인 1155–1157):
   - `auto_judgment_value` → `auto_judgment` 로 교체
   - 임계값 `>= 1` → `>= 0.999`
2. 완료행 스타일을 ABDRD와 통일 (라인 1176):
   - `opacity-60 text-muted-foreground` → `bg-muted/40 text-muted-foreground/70`
3. Sticky 컬럼 배경 처리 (라인 1197):
   - 이미 `isDone ? "bg-muted"` 분기가 있으므로 그대로 유지 (프로젝트 메모리의 "고정 컬럼 100% 불투명" 규칙 준수 — `bg-muted`는 solid 토큰).
4. 부모(main) 행이 동시에 완료인 경우(모든 서브 완료 → rollup 100%)도 자연스럽게 회색으로 보이도록, `isParent && "bg-muted/30 font-medium"` 다음에 `isDone` 클래스가 적용되도록 순서 유지(현행 그대로 후행 병합이면 됨).

### DB 마이그레이션 불필요

값 자체는 이미 정상(actual_progress=1, auto_judgment='완료'). UI 조건만 문제이므로 데이터 보정 없음.

## 검증 방법

- 수정 후 TMRD를 열고 `AR-C-T-01-01`, `AR-C-T-04-06`, `AR-C-T-04-07`, `AR-C-T-04-10` 등 Actual 100% 서브태스크가 회색 배경 + 회색 텍스트로 명확히 흐리게 표시되는지 확인.
- 부분 완료(`0.7641` 등)는 정상 표시 유지되는지 함께 확인.

## 확인 질문

없음 — 원본 지시("완료된 항목은 ABDRD처럼 회색으로 흐리게")대로 ABDRD 스타일과 완전히 동일하게 맞추는 것이 목적임이 명확합니다. 반대 의견 있으시면 알려주세요.
