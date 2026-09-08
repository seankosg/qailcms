# Admin 등급에 계정 관리 전체 개방

## 현재 상태 (실측)

계정 생성·삭제·등급 변경·비밀번호 초기화(개별/일괄)·명부 일괄 생성은 모두 **System Administrator 전용**으로 잠겨 있습니다. 일반 Admin은 사용자 목록 조회, 로그인 ID·프로필 수정, 활성 토글, Export 만 가능합니다.

잠긴 지점 (`src/lib/admin/users.functions.ts`):

| 기능 | 줄 | 현재 게이트 |
|---|---|---|
| 계정 생성 `createAppUser` | 110 | 최상위 전용 |
| 비밀번호 초기화 `resetUserPassword` | 168 | 최상위 전용 |
| 등급 변경 `updateUserRole` | 183 | 최상위 전용 |
| 계정 삭제 `deleteAppUser` | 284 | 최상위 전용 |
| 임시 비밀번호 일괄 `bulkResetTempPassword` | 318 | 최상위 전용 |
| 명부 일괄 생성 | 501 | 최상위 전용 |

화면 측 잠금: `src/routes/_authenticated/admin/users.tsx:224` (`canManageAccounts = isSystemAdmin`) 및 302줄 안내 문구.

## 변경 내용

Admin(및 System Administrator)이 계정 관리 6개 기능을 모두 쓸 수 있게 개방합니다. Superuser 이하는 지금처럼 잠깁니다.

1. 서버: 위 6개 지점의 게이트를 `admin` + `system_administrator` 허용으로 교체(기존 `assertStrictAdmin` 술어 재사용).
2. 화면: `canManageAccounts` 판정을 `isStrictAdmin`(admin 또는 최상위)으로 바꾸고, 잠금 안내 문구를 "Admin 계정만 할 수 있습니다"로 수정. HDEC 명부 탭의 계정 생성 버튼도 동일 기준.

## 유지되는 안전장치 (변경 없음)

- 마지막 System Administrator 계정의 등급 변경·삭제 금지
- 본인 계정 등급 하향 금지, 본인 계정 삭제 금지
- 이름(정본 키) 전역 유일 검사, 임시 비밀번호 형식 검사
- 일괄 초기화는 `must_change_password = true` 계정만 대상

## 추가 검토 필요 (승인 필요 항목)

Admin이 자기 자신 또는 타인에게 **System Administrator 등급을 부여**할 수 있게 할지 여부. 기본안은 **금지**(최상위 등급 부여는 최상위만)로 두겠습니다. 전면 허용을 원하시면 승인 시 알려주세요.

## 검증

- `bunx tsgo --noEmit` 오류 0
- DB 스키마·권한 격자(`rcl_permissions`) 변경 없음 — 코드 게이트만 교체
