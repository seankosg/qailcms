## 목표
Close-Out Doc 섹션의 `Spare Part`, `Warranty & License` 모듈을 Admin(및 Super User) 외 사용자에게는 사이드바에서 숨기고, 라우트로 직접 접근해도 차단합니다.

## 변경 사항

### 1) `src/components/layout/AppLayout.tsx` — 사이드바 노출 제어
- `NavModule` 타입에 `adminOnly?: boolean` 필드 추가.
- `Spare Part` 모듈, `Warranty & License` 모듈에 `adminOnly: true` 지정.
- 렌더링 필터 로직에서 `mod.adminOnly && !me?.isAdmin`인 경우 해당 모듈을 목록에서 제외.
- `CloseOutDashboardPage`의 카드도 동일하게 admin 아닌 사용자에게는 두 카드 숨김 처리 (`useCurrentUser`로 판정).

### 2) 라우트 가드 (직접 URL 접근 차단)
`_authenticated` 하위에 얇은 admin 가드를 재사용해 아래 라우트들에 `beforeLoad`로 관리자 체크를 추가하고, 비관리자는 `/closeout/dashboard`로 리다이렉트:
- `src/routes/_authenticated/closure/spare-part/raw-data.tsx`
- `src/routes/_authenticated/closure/spare-part/import.tsx`
- `src/routes/_authenticated/closure/spare-part/import.logs.tsx`
- `src/routes/_authenticated/closure/spare-part/aconex-sync.tsx`
- `src/routes/_authenticated/closure/spare-part/records.$docRef.tsx`
- `src/routes/_authenticated/closure/dashboard/spare-part.tsx`
- `src/routes/_authenticated/closure/dashboard/warranty.tsx`

가드 로직은 기존 `src/routes/_authenticated/admin/route.tsx`와 동일한 패턴(user_roles 조회 → `admin` 또는 `superuser` 없으면 redirect)을 각 route 파일 `beforeLoad`에 적용하거나, 공용 헬퍼 `assertAdminOrRedirect(to)`를 `src/lib/auth/route-guards.ts`에 추가해 재사용.

### 3) 기본 랜딩 확인
`src/routes/_authenticated/admin/route.tsx`가 관리자 아닐 때 `/closure/spare-part/raw-data`로 리다이렉트하는 부분이 있으므로, 이 fallback을 `/outstanding/dashboard`로 교체 (일반 사용자가 이제 spare-part 접근 불가하므로).

## 권한 정책
- 노출/접근 가능: `isAdmin`(즉 `admin` 또는 `superuser` 롤). 기존 앱의 `adminOnly` 판정과 동일하게 처리.
- 그 외(Senior User, User, D-Superuser, Guest 등) 모두 차단.

## 검증
- 비관리자 계정으로 로그인 시 사이드바에 두 모듈이 표시되지 않는지 확인.
- 비관리자 계정에서 `/closure/spare-part/raw-data` 등 URL 직접 접근 시 리다이렉트되는지 확인.
- 관리자 계정에서는 기존과 동일하게 접근 가능한지 확인.
