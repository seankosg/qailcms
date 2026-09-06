# Guest / Super Guest 접근 범위 제한

## 목표

- **Guest**: 각 모듈의 **Dashboard 페이지만** 접근 가능. 그 외 모든 페이지(Progress, Raw Data, 상세, KPI, Import, Work Space, Project Wide, Admin) 차단.
- **Super Guest**: 모듈의 **조회 페이지 전부** 접근 가능. 관리 성격 페이지(Import, Settings, Daily Entry, Admin, Schedule Revision 등 쓰기 화면)는 차단.
- 상위 역할(user 이상)의 접근 범위는 **변경 없음**.

## 접근 격자 (확정)

| 경로 | Guest | Super Guest |
|---|:--:|:--:|
| /closure/task-management/dashboard | 허용 | 허용 |
| /closure/snag-management/dashboard | 허용 | 허용 |
| /closure/abd/dashboard | 허용 | 허용 |
| /closure/spare-part/dashboard | 허용 | 허용 |
| /resource/dmr/dashboard, /resource/dashboard | 허용 | 허용 |
| /closure/dashboard(허브), /closure/dashboard/* | 허용 | 허용 |
| Progress / Raw Data / Tree / KPI Analysis / 상세($id) | 차단 | 허용 |
| /project-dashboard, /project-summary, /organization | 차단 | 허용 |
| /my-work-space, /my-team-work-space, /my-kpi-analysis | 차단 | 허용 |
| Import·Import Logs, /closure/snag-management/settings, /closure/task-management/schedule-revision, /resource/dmr/entry | 차단 | 차단 |
| /admin/** | 차단 | 차단 (기존 가드 유지) |

Guest 로그인 후 첫 화면 및 차단 시 리다이렉트 대상: `/closure/task-management/dashboard`.
Super Guest 차단 시 리다이렉트 대상: 기존과 동일하게 `/project-dashboard`.

## 구현 방식

1. **접근 정책 정본 1곳 신설** — `src/lib/auth/route-access.ts`
   - `routeAccessTier(path)` → `"dashboard" | "read" | "manage" | "admin"` 로 경로를 분류(문자열 prefix 매칭, 위 표 그대로).
   - `canAccessPath(roleFlags, path)` → Guest는 `dashboard`만, Super Guest는 `dashboard`+`read`, 그 외 역할은 기존과 동일하게 전부 true.
   - 순수 함수로 두어 라우트 가드·사이드바·링크 비활성화가 **같은 판정**을 쓴다.

2. **라우트 가드** — `src/routes/_authenticated/route.tsx`의 `beforeLoad`에 판정 추가
   - 세션 확인 후 `user_roles`를 읽어 guest / super_guest 여부를 구하고, `canAccessPath`가 false면 위 리다이렉트 경로로 `redirect()`.
   - URL 직접 입력·북마크로도 우회되지 않도록 게이트를 이 한 곳에 둔다. 기존 `/admin` 가드와 `assertAdminOrRedirect`는 그대로 유지(중복이지만 상위 보호).
   - guest/super_guest가 아닌 사용자에게는 추가 쿼리가 이미 있는 세션 조회 범위 내에서만 돌도록 하고, 판정 결과는 라우트 컨텍스트로 넘겨 재조회를 줄인다.

3. **사이드바 필터** — `src/components/layout/AppLayout.tsx`
   - `NAV` 렌더 시 각 항목의 `to`에 `canAccessPath`를 적용해 접근 불가 항목은 **표시하지 않음**. 항목이 모두 사라진 모듈/섹션도 숨김.
   - Guest는 결과적으로 Dashboard 링크들만 남는다.

4. **Guest 드릴다운 차단** — 대시보드 안의 Raw Data 이동 링크
   - 공용 훅 `useCanNavigate()`(신설, `canAccessPath` 래핑)를 대시보드 드릴다운 지점에 적용해 Guest에게는 링크를 **클릭 불가(비활성 스타일 + 커서 default)** 로 렌더.
   - 대상: TM/SM/ABD/SPL/DMR 대시보드의 KPI 카드·매트릭스 셀·차트 드릴다운 등 Raw Data 또는 상세($id)로 나가는 링크 전부. 구현 전에 각 대시보드의 드릴다운 호출부를 열람해 누락 없이 목록화한다.
   - 링크 외 UI(수치·색상·툴팁·필터)는 변경하지 않는다.

## 변경하지 않는 것

- DB `rcl_permissions` 격자, `rcl_grants`/`rcl_can` 등 서버 판정 로직 (읽기/쓰기 권한은 현행 유지).
- 대시보드·매트릭스의 집계 로직, 열 구성, 필터, 색상 토큰.
- Guest·Super Guest 외 역할의 화면 구성.

## 검증

- `bunx tsgo --noEmit` 오류 0.
- 브라우저 실측: Guest 계정으로 (1) 사이드바에 Dashboard 항목만 남는지, (2) `/closure/abd/raw-data` 직접 입력 시 리다이렉트되는지, (3) 대시보드 드릴다운이 클릭 불가인지 확인.
- Super Guest 계정으로 (1) Progress/Raw Data/상세 진입 가능, (2) Import·Settings·Admin 진입 시 리다이렉트 확인.
- 상위 역할 1개 계정으로 회귀 확인(기존 화면 접근 이상 없음).
