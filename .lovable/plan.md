## 문제 원인 (실측 확인)

`task_management_status_history`는 값 변경 시 `(old→NULL)` + `(NULL→new)` 두 행을 쌍으로 기록합니다. 현재 `getTaskProgressChartDetail` 핸들러는 `new_value` 문자열을 `Number(raw) || 0`으로 파싱하면서 `NULL`을 **0으로 취급**해서, 실제 진도율이 유지되는 구간에서 0%로 급락하는 지그재그가 그려집니다.

AR-C-T-04 실측:
```
07-19 04:57  null → 0.6435
07-20 04:18  0.6435 → null   ← 0%로 찍힘
07-20 04:18  null → 0.6223
07-20 15:45  0.6223 → null   ← 0%로 찍힘
07-22 06:24  null → 0.6514
```

## 수정 범위

`src/lib/task-management/progress-chart.functions.ts` 의 `getTaskProgressChartDetail` 핸들러 한 곳:

1. 히스토리 조회 시 `.not('new_value','is',null)` 필터를 추가해 NULL 행을 원천 배제.
2. 방어적으로 루프 안에서도 `h.new_value == null` 이면 skip.
3. 히스토리 개수 판단(`>= 2` fallback 분기)은 NULL 제거 후 카운트로 판단.
4. 같은 도하 날짜(`d`)에 여러 유효 이벤트가 있으면 **가장 늦은 시각의 값**을 채택(현재 dialog 쪽 Map 병합이 삽입 순서상 마지막 값을 남기므로 서버 정렬만 오름차순 유지하면 자연히 성립. 별도 dedupe 로직은 추가하지 않음).

캐시 갱신 로직(`recalc_task_progress_charts` RPC/`task_progress_chart_cache`)은 이번 스코프에서 건드리지 않습니다. 팝업 차트는 매번 서버에서 즉시 재계산되므로 코드 수정만으로 즉시 반영되고, 미니 스파크라인은 다음 05시 캐시 재계산 때 자연스럽게 갱신됩니다. 만약 사용자가 원하면 캐시 SQL 함수도 동일하게 NULL 제외하도록 후속 조치 가능합니다.

## 검증

- 수정 후 AR-C-T-04 팝업에서 실적선이 07-19 64.35% → 07-20 62.23% → 07-22 65.14% 로 부드럽게 이어지는지 확인.
- 히스토리가 0~1건인 태스크는 기존 fallback(`actual_start`=0, `data_date`=현재 진도율) 그대로 동작하는지 확인.

## 기술 상세

```ts
const { data: hist } = await supa
  .from("task_management_status_history")
  .select("new_value, changed_at")
  .eq("discipline", data.discipline)
  .eq("task_no", data.task_no)
  .eq("field", "actual_progress")
  .not("new_value", "is", null)   // 추가
  .order("changed_at", { ascending: true })
  .limit(2000);
```

루프 내부:
```ts
for (const h of hist) {
  if (h.new_value == null) continue;   // 방어
  const v = Math.max(0, Math.min(1, Number(h.new_value) || 0));
  ...
}
```

캐시 함수(`recalc_task_progress_charts`)도 동일 규칙으로 맞출지 여부는 사용자 확인 후 후속 마이그레이션으로 처리.
