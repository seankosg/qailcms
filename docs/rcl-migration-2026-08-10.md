# RCL 권한 격자 이관 이력 (2026-08-10)

## 배경

TM 삭제 권한이 admin 에게만 열려 있는 것을 확인하면서 시작했다. 역할 이름을 코드와 정책에 하드코딩하던 방식을 전부 걷어내고, 판정 근거를 `rcl_permissions` 격자(role × scope × action) 하나로 모으는 작업이다. 격자 기준값은 **105행 / allowed=true 67행**이며, 이 값은 이관 내내 바뀌지 않았다.

- scope: `own` · `own_team` · `other_team`
- action: `read` · `write` · `delete` · `import` · `export`
- 모듈별 소유자 판정 정본은 `rcl_module_config`
  - TM `task_management_raw`(주관팀 없음), ABD `abd_items_raw`(DESN), SM `defect_items_raw`(QAQC), SPL `spl_items`(PRJC), WRT `wrt_items`(PRJC)
  - 소유자 칸: TM·ABD·SM = `hdec_pic_name` · `hdec_eng_name`, SPL·WRT = `pic` · `eng`

## 판정 축 — 표마다 둘 중 하나

- 소유자 칸이 **있는** 표 → **행 범위 판정**: `rcl_can(uid, MODULE, id, action)`
- 소유자 칸이 **없는** 로그·이력 표 → **모듈 판정**: `rcl_grants(MODULE, action)` 세 범위 중 하나라도 참이면 통과

이 구분을 틀리면 조용히 막힌다. 소유자 칸이 없는 표에 `rcl_can` 을 걸면 `rcl_scope` 가 칸을 못 찾아 전부 `other_team` 으로 떨어지고, 관리자 외에는 아무도 쓰지 못한다.

## 이관 중 세운 규칙

1. **SELECT 정책은 전 표에서 건드리지 않는다.** 3-1에서 TM 아이템 표 SELECT까지 옮겼다가 5분 만에 되돌렸다. `tm_rows_as_of` / `tm_items_search` 가 INVOKER 함수라 읽기 정책을 좁히면 사람마다 차트 모수가 달라진다. 완전 중복 정책 정리만 허용.
2. **`FOR ALL` 정책은 INSERT·UPDATE·DELETE 셋으로 쪼갠다.** `FOR ALL` 은 SELECT를 포함하므로 그대로 바꾸면 읽기가 좁아진다(WRT·SPL 임포트 로그 4표).
3. **옛 정책은 반드시 지운다.** 정책은 OR로 합쳐지므로 남으면 아무것도 좁혀지지 않는다.
4. **없던 DELETE 정책을 새로 만들지 않는다.** `wrt_change_log` · `spl_change_log` 에 DELETE 정책이 없는 것은 이력 표로서 맞다. 없는 것을 만드는 것은 넓히는 것이다.
5. **DB 상태 변경은 예외 없이 마이그레이션 파일로**, 기존 파일은 수정하지 않는다. 되돌릴 때도 새 파일.

## 적용된 마이그레이션

| 타임스탬프 | 범위 |
|---|---|
| 20260810151345 | TM 아이템 표 (`task_management_raw`) |
| 20260810151830 | 위 SELECT 이관 되돌림 (`USING(true)` 복원) |
| 20260810152001 | TM 자식·로그 4표 |
| 20260810152720 | SM 4표 + TM SELECT 완전중복 정리 |
| 20260810154856 | ABD 4표 |
| 20260810161148 | WRT·SPL 로그 6표 |
| 20260810162820 | `import_field_logs` (kind 로 모듈 판정하는 공용 표) |
| 20260810164950 | 서버 함수 7건 |

`import_field_logs` 는 `kind` 칸으로 여러 모듈이 함께 쓰는 공용 표라 마지막에 따로 처리했다. TS 유니온에는 아직 없지만 `'wrt'` 갈래를 미리 넣어 두었다 — WRT 임포트가 필드 로그를 남기기 시작할 때 ELSE 거부에 걸려 조용히 사라지는 사고를 막기 위해서다.

서버 함수 7건: `wrt_hdec_apply` · `spl_hdec_apply` · `abd_aconex_apply_diffs`(모듈 import), `delete_task_management_import_batch` · `delete_abd_import_batch` · `delete_defect_import_batch`(모듈 전체 delete — `rcl_max_scope(...) = 'other_team'`), `can_rollback_import_batch`(소유자 갈래·spare_part 갈래 유지). 배치 삭제가 세 범위 OR가 아니라 `other_team` 을 요구하는 이유는 배치가 만든 행 전체를 지우므로 행 범위 개념이 성립하지 않기 때문이다. 이 변경으로 TM 배치 삭제에 superuser 가 새로 들어왔다.

## 앱 코드

SECURITY DEFINER 가 아닌 경로에서 역할을 직접 확인하던 곳을 격자로 바꿨다: SM 배치 삭제, ABD Aconex 임포트. ABD Aconex는 **게이트를 열기 전에** 행 스코프(`rcl_import_filter` + `assertImportScope`)를 먼저 붙였다 — 순서를 반대로 하면 own 범위만 가진 사용자가 ABD 전건을 패치한다. `rcl_import_filter` 는 `COALESCE(to_jsonb(t), i.e)` 로 DB 저장값을 파일 값보다 우선하므로, 기존 행만 다루는 임포트는 소유자 칸을 null로 보내도 판정이 맞다.

### 이번 범위에서 제외

ABD OCS 함수군, 설정·마스터 표, Milestone 임포트(DB 트리거 `tm_guard_milestone_admin_only` 와 함께 봐야 함), 백업·계정·라우트 가드. `tm_edit_record_daily` 는 읽기·감독용 함수인데 `read` 로 옮기면 guest 까지 들어와 지금보다 넓어지므로 보류.

## 조용한 실패 제거

RLS가 막으면 PostgREST는 에러 없이 0행을 돌려준다. 삭제가 한 건도 안 됐는데 "삭제 완료 · 0 rows" 가 초록색으로 떴다. 하드 삭제 셋(TM·ABD·SM)과 SM Critical 토글을 `.select("id")` 로 실제 처리 행을 받아 `{requested, count, blocked}` 를 돌려주도록 바꾸고, 화면은 0건이면 성공 토스트를 띄우지 않고 부분 차단이면 별도 알린다. 필드 로그 삽입 실패도 임포트 결과에 실었다.

권한 게이트를 걷어낼 때 이 처리를 같이 하지 않으면 문제가 오히려 늘어난다. `bulkToggleCritical` 이 그 예다 — 전에는 admin 만 눌러 RLS가 막을 일이 없었으나, 게이트를 격자로 바꾸는 순간 막힌 행이 생기고 화면은 바뀐 것처럼 보였다.

## 부수 발견 — SM 이력

- 부모를 먼저 지우면 이력이 고아로 남는다. `dsh_delete` 정책은 `rcl_can(..., defect_raw_id, 'delete')` 인데, 부모가 이미 사라지면 `rcl_scope_core` 가 소유자·행팀 갈래를 건너뛰고 주관팀(QAQC)만 본다. QAQC 소속이 아니면서 own · own_team 범위로만 삭제 권한이 있는 사용자는 부모만 지워지고 이력이 조용히 남는다. → `rcl_can_rows` 로 허용 id 를 먼저 판정하고 **이력 → 부모** 순으로 삭제.
- 고아 이력 **112,755건**(전체 686,783건 중, `defect_raw_id` NULL 0건). 원인은 `delete_defect_import_batch` 가 이력을 `upload_id = _batch_id` 로만 지우는 것. 배치 A가 만든 행을 배치 B가 고치면 그 이력의 `upload_id` 는 B이므로, A를 지우면 부모는 사라지고 B가 쓴 이력만 남는다. → 지운 부모 id 를 `RETURNING` 으로 받아 `upload_id = _batch_id OR defect_raw_id = ANY(_ids)` 로 함께 삭제.
- SM 상세의 변경 이력 패널은 처음부터 비어 있었다. `DefectDetailPage.tsx` 가 `defect_status_history` 를 `defect_id` 로 조회했는데 그런 칸이 없다(`defect_raw_id`). 쿼리 에러를 `return []` 로 삼켰다. 이 한 줄 때문에 11만 건의 고아를 아무도 볼 수 없었다.

## 남은 것

- ABD OCS 함수군, 설정·마스터 표, Milestone 임포트와 그 트리거, `tm_edit_record_daily` 판단
- 고아 이력 112,755건 정리 여부 — `source_issue_no` 로 되살릴 수 있는 것이 섞여 있는지 확인 후 결정(실측: 112,755건 전부 `source_issue_no` 가 현재 `defect_items_raw` 에 살아 있음, 고유 번호 74,752개)