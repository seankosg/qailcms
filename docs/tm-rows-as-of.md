# tm_rows_as_of

`tm_rows_as_of` 는 `tm_rows_as_of_notc` 를 감싸 tc 두 열(`tc_actual_pct`, `tc_plan_pct`)만 얹는다.
본체를 고칠 때는 `tm_rows_as_of_notc` 를 고친다.

## 성능 메모 (2026-08-12)
tc 두 열 비용은 전일 `tm_row_tplan` 호출 ~347ms (main 279행 135ms / sub 1,796행 211ms).
sub 를 `tm_kpi_tplan` 직접 호출로 대체하면 ~200ms 줄지만 main/sub 분기를 밖에 복제하게 되므로 하지 않는다.
속도가 다시 문제가 되면 tc 가 아니라 `tm_rows_as_of_notc` 의 1,050ms 부터 본다.
