## 배경
이전에 188건 백필했으나, 이후 임포트/편집으로 다시 60건의 Sub Task가 `hdec_pic_name` 비어있음. 모두 부모 Main Task에는 값 존재 확인.

## 작업
`task_management_raw`에 1회성 마이그레이션 실행:

```sql
UPDATE task_management_raw s
SET hdec_pic_name = p.hdec_pic_name
FROM task_management_raw p
WHERE s.level = 'sub'
  AND (s.hdec_pic_name IS NULL OR s.hdec_pic_name = '')
  AND p.discipline = s.discipline
  AND p.task_no = s.main_task_no
  AND p.hdec_pic_name IS NOT NULL
  AND p.hdec_pic_name <> '';
```

- 예상 갱신: 60건
- `hdec_eng_name`은 이번 요청 범위 밖이라 건드리지 않음
- 스키마 변경 없음, 데이터만 갱신
