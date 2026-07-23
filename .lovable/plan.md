## 목적
Task Tree의 Main Task 카드 뱃지/판정을 **Sub Task와 동일한 로직**으로 통일합니다. 현재는 하위 Sub Task 판정의 worst-of 를 뱃지로 보여주고 있어, 롤업된 Main Task 자체의 진도율(`actual_progress` vs `plan_progress`)과 시각적으로 어긋납니다.

## 현재 동작 (확인됨)
`src/components/task-management/tree/TaskTreePage.tsx` L397:
```
const worst = worstJudgment(kids.map((k) => k.auto_judgment)) ?? p.auto_judgment;
```
→ Main 뱃지가 **하위 Sub 판정 중 최악값**으로 표시됨.

L188 (판정 필터):
```
const mainJ = judgeOf(p) || (worstJudgment(kids.map((k) => k.auto_judgment)) ?? "");
```
→ Main 자체 판정이 비었을 때 Sub worst 로 폴백.

`p.auto_judgment` 자체는 DB의 `update_task_summary` 롤업으로 Main의 롤업된 `actual_progress`/`plan_progress`를 기반으로 `computeJudgment` 되어 저장됨 (Sub 와 동일 산식).

## 변경 내용
`src/components/task-management/tree/TaskTreePage.tsx` 만 수정합니다. DB 로직/롤업/스키마 변경 없음.

1. **Main 판정 뱃지 (L397)** — Sub worst-of 대신 Main 자신의 판정 사용:
   ```
   const mainJudgment = (p.auto_judgment && p.auto_judgment.trim())
     || computeJudgment(p, undefined, asOfDate);
   ```
   뱃지 렌더링도 `worst` → `mainJudgment` 로 교체.

2. **판정 필터 폴백 (L188)** — Main 판정이 없을 때 Sub worst 폴백 제거. Main 자신의 값만 사용 (그 값이 없으면 `computeJudgment(p)` 로만 대체). Sub 판정은 `kids.some(...)` 매칭에서 그대로 유지.

3. **"지연 N" 카운트 뱃지 (L433-434)** — 이 뱃지는 "하위 Sub 중 지연 개수" 정보용이며 사용자가 유지 요청한 뱃지 스코프(=Main 자체 판정)와 별개 요약 지표입니다. 요구사항 문구가 "뱃지들"로 복수형이라 다음 중 어느 쪽을 원하시는지 확인이 필요합니다:
   - (A) 유지 — 지연된 Sub 개수 표시는 정보성이므로 그대로 둠.
   - (B) 제거 — 모든 뱃지를 Main 자체 판정만 반영.

## 검증
- Main의 롤업 `actual_progress` / `plan_progress` 가 정상 범위인 태스크에서 하위 1개만 위험이어도 Main 뱃지는 더 이상 "위험"으로 뜨지 않고 Main 자체 판정을 표시.
- Progress 바(`ProgressBar v={p.actual_progress}`)/GapCell(`computeVariance(p)`) 과 뱃지 색이 일치.
- 판정 필터로 "지연/위험" 선택 시, Main 자체 판정이 해당하지 않아도 하위 Sub 중 해당 항목이 있으면 카드가 표시되는 동작은 유지.

## 질문
"지연 N" (하위 지연 Sub 개수) 뱃지는 (A) 유지 / (B) 제거 중 어느 쪽으로 처리할까요?
