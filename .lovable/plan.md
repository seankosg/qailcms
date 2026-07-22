## Rectified 스테이지 3조건 실측 결과: 백필 대상 0건

Start와 동일한 3조건을 적용:
1. `rectified_status = 'Done'`
   = `isStageDone(row,'rectified')`
   = `actual_rectified_date IS NOT NULL` OR `actual_progress_pct ≥ 100` OR `actual_closure_date IS NOT NULL`
2. `actual_rectified_date IS NULL`
3. `planned_rectified_date IS NOT NULL`

`is_active=true AND status_group='unclosed'` 대상:

| 항목 | 건수 |
|---|---:|
| Rectified Done 총계 | 7,744 |
| Done 이지만 `actual_rectified_date IS NULL` | **0** |
| 3조건 모두 만족 (백필 대상) | **0** |

추가 sanity check도 0건 확인:
- `actual_progress_pct ≥ 100` 이면서 `actual_rectified_date IS NULL` → 0건
- `actual_closure_date IS NOT NULL` 이면서 `actual_rectified_date IS NULL` → 0건

즉 Rectified 스테이지는 UI 상 Done인 모든 행이 이미 `actual_rectified_date`를 가지고 있어 **백필할 데이터가 없습니다**. Closure도 마찬가지로 `closure_status='Done' ⇔ actual_closure_date IS NOT NULL` 이므로 구조적으로 백필 대상이 0건입니다.

## 결론

- 이전 승인안 그대로 **Start 스테이지만 1,721행 백필** 하면 됩니다.
- Rectified/Closure에는 마이그레이션·백필 필요 없음.
- 계획서(Start 전용 스냅샷 + planned_start_date → actual_start_date 복사) 변경 없음.

이 상태로 build 모드 승인 부탁드립니다.