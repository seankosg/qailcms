## 확인된 데이터

- Sub Task 중 `hdec_pic_name IS NULL` = **248건**
- 이 중 상위 Main Task의 `hdec_pic_name`이 존재하여 즉시 보정 가능 = **248건 (100%)**
- 상위 없음(main_task_no null) / 상위도 null 인 케이스 = **0건**

## 1회 마이그레이션

`main_task_no` 로 상위 Main 행을 조인해 `hdec_pic_name` 을 채운다.
`hdec_eng_name` 은 이번 지시에서 언급되지 않았으므로 **건드리지 않는다**.

```sql
UPDATE public.task_management_raw AS s
SET hdec_pic_name = m.hdec_pic_name
FROM public.task_management_raw AS m
WHERE s.level = 'sub'
  AND s.hdec_pic_name IS NULL
  AND s.main_task_no IS NOT NULL
  AND m.task_no = s.main_task_no
  AND m.level = 'main'
  AND m.hdec_pic_name IS NOT NULL;
```

- 예상 영향 248행.
- 트리거 부수효과: `trg_auto_owner_user_id` 가 hdec_pic_name 기반으로 `owner_user_id` 를 자동 매핑, `trg_task_history_fn` 이 이력 남길 수 있음 (허용).
- 이번 작업은 DB 1회 마이그레이션만이며, 임포트 파서/컨텍스트 로직은 이미 부모→자식 propagate 규칙이 별도로 운영되므로 이번 지시 범위 외로 변경하지 않는다.
