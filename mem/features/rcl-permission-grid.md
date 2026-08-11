---
name: RCL 권한 격자 정본
description: 권한 판정은 rcl_permissions 격자(105행/allowed 67) 단일 근거. 행 범위 vs 모듈 판정 구분, SELECT 정책 불변, FOR ALL 분해, 조용한 실패 금지 규칙
type: feature
---
권한 판정 근거는 `rcl_permissions` 격자(role × scope × action) 하나뿐이다. 역할 이름을 정책·앱 코드에 하드코딩하지 않는다. 기준값 105행 / allowed=true 68행 (2026-08-11 `user·write·own_team` 개방 승인 반영, 이전 67행). 변경 시 반드시 보고.

- 소유자 칸(팀·담당자)이 있는 표 → 행 범위 판정 `rcl_can(uid, MODULE, id, action)` / 다건은 `rcl_can_rows`.
- 소유자 칸이 없는 로그·이력 표 → 모듈 판정 `rcl_grants(MODULE, action)` 세 범위 OR.
- 배치 전체를 지우는 함수는 행 범위 개념이 없으므로 `rcl_max_scope(...) = 'other_team'` 을 요구한다.
- 소유자 칸 정본은 `rcl_module_config` (TM·ABD·SM = hdec_pic_name/hdec_eng_name, SPL·WRT = pic/eng).

불변 규칙
- SELECT 정책은 격자로 옮기지 않는다. `tm_rows_as_of`/`tm_items_search` 가 INVOKER 라 읽기를 좁히면 사용자마다 차트 모수가 달라진다. 완전 중복 정책 정리만 허용.
- `FOR ALL` 정책은 INSERT·UPDATE·DELETE 로 쪼개서 이관한다(SELECT 포함 방지).
- 옛 정책은 반드시 DROP (정책은 OR 로 합쳐진다).
- 없던 DELETE 정책을 새로 만들지 않는다(예: `wrt_change_log`, `spl_change_log`).
- 임포트는 게이트 교체 **전에** 행 스코프(`rcl_import_filter` + `assertImportScope`)를 먼저 붙인다.
- 권한 게이트를 넓힐 때는 조용한 실패 제거를 함께 한다: 쓰기/삭제는 `.select("id")` 로 실제 처리 행을 받아 `{requested, count, blocked}` 반환, 0건이면 성공 토스트 금지.

상세 이력: `docs/rcl-migration-2026-08-10.md`