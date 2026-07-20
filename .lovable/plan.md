## 문제 진단 (확인 완료)

- 사용자 서창훈의 역할: `d_superuser` (user_roles 테이블 확인)
- `task_management_raw` INSERT/UPDATE 정책은 `has_any_role(auth.uid(), ARRAY['user','superuser','admin'])`만 통과시킴
- `d_superuser`와 `senior_user`는 배열에 포함되지 않아 RLS로 차단됨 → 캡쳐의 42501 에러 원인
- 동일한 배열을 쓰는 정책이 총 **28개** 존재 (task_management_raw, task_management_import_logs, task_management_import_row_logs, task_management_status_history, abd_items_raw, defect_items_raw, spare_parts_raw, spare_part_* 8개, spare_parts_import_logs, spare_parts_sync_log 포함)

즉, 서창훈뿐 아니라 모든 `d_superuser`/`senior_user`는 지금 TM/ABD/SM/Spare Parts 임포트와 편집이 전부 막혀 있는 상태입니다.

## 수정 방안

역할 랭크 정책과 일치시키기 위해 위 28개 정책의 role 배열에 `d_superuser`, `senior_user`를 추가합니다.
`ROLE_RANK` 기준상 두 역할은 이미 최소 `user` 이상의 편집 권한을 가져야 합니다(앱 코드/사이드바 상 이미 그렇게 취급됨).

### 단일 마이그레이션 (1회)

각 대상 테이블마다:

```sql
DROP POLICY "<기존 정책명>" ON public.<table>;
CREATE POLICY "<동일 정책명>" ON public.<table>
  FOR INSERT|UPDATE TO authenticated
  USING (has_any_role(auth.uid(),
    ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(),
    ARRAY['user','senior_user','superuser','d_superuser','admin']::app_role[]));
```

대상 테이블(28개 정책 / 14개 테이블):
- task_management_raw, task_management_import_logs, task_management_import_row_logs, task_management_status_history
- abd_items_raw
- defect_items_raw
- spare_parts_raw, spare_parts_import_logs, spare_parts_sync_log
- spare_part_change_log, spare_part_comments, spare_part_custom_fields, spare_part_import_row_logs, spare_part_status_history

### 검증

마이그레이션 후:
1. `pg_policies`에서 갱신된 정책 5개 role이 모두 포함되었는지 재확인
2. 서창훈 계정으로 유첨 파일 재임포트 → 46행이 정상 업데이트되는지 확인

## 참고

- 앱 코드나 파서/임포트 컨텍스트는 손대지 않습니다. RLS 정책만 재발행합니다.
- 다른 곳에서 role 배열이 축약되어 사용되는지 재검토 후 있으면 함께 확장할지 여부는 필요 시 별도 조치로 남깁니다(이번 스코프는 위 28개 정책).