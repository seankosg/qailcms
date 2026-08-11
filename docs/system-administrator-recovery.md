# System Administrator 복구 절차

최상위 등급(`system_administrator`) 전환 중 화면 게이트가 새 등급을 모르는 번들이 배포되어
최상위 계정이 `/admin` 에서 잠긴 경우의 되돌리기 절차다.

## 준비 — 키를 어디서 얻는가

- 이 문서에 키 값을 적지 않는다.
- `service_role` 키와 데이터베이스 접속 정보는 백엔드 관리 화면(Lovable Cloud) 에서만 얻는다.
  (프로젝트 → Cloud → 백엔드/서버 키 항목)
- 앱 코드·저장소·이 문서에는 절대 복사해 두지 않는다. 사용 후 로컬 셸 기록도 지운다.

## 대상 계정

- 계정 식별은 **uuid** 로 한다. 이름·이메일로 찾지 마라.
- 최상위 계정 uuid: `profiles` 에서 `login_id in ('admin','sadmin')` 으로 조회해 확인한다.

```sql
select id, login_id, name from public.profiles where login_id in ('admin','sadmin');
```

## 1) 등급 되돌리기 (service role 로 실행)

새 등급이 화면에서 통하지 않는 동안 `admin` 등급만으로 다시 들어간다.
uuid 는 바꾸지 않는다. 행 삭제는 `user_roles` 한 표에서만 한다.

```sql
-- 최상위 등급 행만 제거하고 admin 은 유지/복원
insert into public.user_roles (user_id, role)
values ('<UUID>', 'admin')
on conflict (user_id, role) do nothing;

delete from public.user_roles
where user_id = '<UUID>' and role = 'system_administrator';
```

## 2) 로그인 껍데기 되돌리기 (필요할 때만)

```sql
update auth.users  set email = 'admin@qail.local' where id = '<UUID>';
update public.profiles set login_id = 'admin', name = '시스템관리자' where id = '<UUID>';
-- name_norm 은 생성 칸이다. 직접 쓰지 마라.
```

## 3) 다시 올릴 때

배포된 번들이 `system_administrator` 를 아는 것을 확인한 뒤에만 되돌린다.

```sql
insert into public.user_roles (user_id, role)
values ('<UUID>', 'system_administrator')
on conflict (user_id, role) do nothing;
```

## 금지

- uuid 변경 · 새 계정 생성 · 옛 계정 삭제 (참조 기록 70여 자리가 uuid 로 걸려 있다)
- `app_role` enum 값 삭제/개명 (Postgres 가 지원하지 않는다)
- 감사 로그(`rcl_permissions_audit`, `rcl_module_config_audit`) 삭제
- `rcl_permissions` 격자 값 수정 (복구는 등급 행만 다룬다)
