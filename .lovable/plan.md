## 근본 원인

임포트 실패 메시지:
```
column "row_id" of relation "abd_change_log" does not exist
```

`abd_change_log` 실제 스키마 컬럼: `id, abd_item_id, team, abd_number, field, old_value, new_value, source, upload_id, changed_by, changed_at`

그런데 UPDATE 트리거 `public.trg_abd_change_log_fn` (26~28행)이 존재하지 않는 컬럼 `row_id`에 INSERT 하고 있음:

```sql
INSERT INTO public.abd_change_log(row_id, field, old_value, new_value, changed_by, source)
VALUES (NEW.id, _f, _old->_f, _new->_f, auth.uid(), _source);
```

또한 `upload_id`가 채워지지 않아 롤백/삭제 함수(`delete_abd_import_batch`, `rollback_abd_import` 등이 `upload_id = _batch_id`로 조회)가 임포트 변경 로그를 잡지 못함. `team`/`abd_number`도 누락.

앞서 `abd_compute_derived` 트리거를 고쳤을 때 upsert가 실제로 UPDATE 경로를 타게 되면서(이전엔 어떤 이유로 INSERT-only였거나 실제로 도달하지 못했음) 이 트리거가 처음으로 실행되어 표면화된 것.

## 해결 계획 (마이그레이션 1건)

`trg_abd_change_log_fn` 재작성:

1. 컬럼명을 실제 스키마에 맞게 `abd_item_id`로 교정.
2. `upload_id`, `team`, `abd_number`를 함께 기록해 롤백/미리보기 함수와 정합:
   ```sql
   INSERT INTO public.abd_change_log(
     abd_item_id, team, abd_number, field, old_value, new_value,
     source, upload_id, changed_by
   ) VALUES (
     NEW.id, NEW.team, NEW.abd_number, _f,
     _old->>_f, _new->>_f,
     _source,
     NULLIF(current_setting('app.upload_id', true), '')::uuid,
     auth.uid()
   );
   ```
   (기존은 `_old->_f` jsonb를 text 컬럼에 넣던 것도 `->>` text로 교정.)
3. 파서/업서트 쪽 코드 변경 없음. `app.change_source`/`app.upload_id` GUC는 이미 임포트 경로에서 세팅되고 있다는 가정 하에 그대로 사용하고, 세팅되지 않은 수동 편집 시에는 upload_id=NULL, source='manual' 로 남김.

## 검증

- MECH 2,596 / ELEC 4,061 재임포트 → Failed 사라짐.
- 롤백 미리보기가 update_count/conflict_count를 정상 계산.
- `tsgo` 는 스키마만 변경이라 영향 없음.

## 왜 근원적인가

- 파서·업서트 페이로드는 정상이며 표면 오류는 순전히 UPDATE 트리거의 잘못된 컬럼명. 이 트리거만 정정하면 status_mismatch 계열 후속 결함이 재현하지 않음.
- upload_id/team/abd_number까지 채워두어 이후 롤백·감사·대시보드 change_log 소비 로직이 스키마 기대와 다시 일치.
