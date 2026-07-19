## 원인 (확인됨)

`public.resolve_login_email(text)` 함수의 실행 권한(ACL) 조회 결과:

```
authenticated=X, service_role=X, sandbox_exec=X   (anon 없음)
```

로그인 화면(`/auth`)은 아직 세션이 없는 **anon** 역할로 이 함수를 호출합니다. 최근 보안 취약점(`SUPA_anon_security_definer_function_executable`) 조치 시 anon EXECUTE 권한이 일괄 회수되면서, 로그인 ID → 이메일 변환 RPC도 함께 제외되어 신규/재로그인 사용자 모두 `permission denied for function resolve_login_email` 오류가 발생합니다.

## 조치

로그인 플로우에 반드시 필요한 함수이므로 anon 에게만 선별적으로 실행 권한을 재부여합니다. 함수는 이미 `SECURITY DEFINER` + 내부에서 활성 계정만 조회하도록 설계되어 있어 다른 데이터 노출 위험은 없습니다.

### 마이그레이션

```sql
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon;
```

### 후속 검증
1. 로그아웃 상태에서 `/auth` 진입 → ID/PW 로그인 성공 확인.
2. 보안 스캐너 재실행 시 이 함수는 "로그인 게이트웨이 예외" 로 문서화 (@security-memory 업데이트).

## 스코프 외
- 다른 SECURITY DEFINER 함수의 anon 권한은 기존대로 유지 (재노출하지 않음).
- 클라이언트 코드(`resolveLoginEmail.functions.ts`, `auth.tsx`) 변경 없음.
