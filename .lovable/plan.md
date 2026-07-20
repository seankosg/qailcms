## 확인된 현재 상태

- DB 기준으로 `서창훈` 사용자(`chseo@qail.local`)의 역할은 `user_roles.role = d_superuser`로 정상 저장되어 있습니다.
- 사용자 관리 페이지도 `user_roles`를 읽고 있으므로, 사용자 관리의 역할 저장 자체가 원인은 아닙니다.
- `useCurrentUser.ts`의 현재 계산은 `d_superuser`를 `isEditor`에 포함하고 있지만, `isAdmin`에는 포함하지 않습니다.
- 사이드바 로그인 정보창(`AppLayout.tsx`)은 현재 3단계만 표시합니다.
  - `me.isAdmin`이면 `Admin` 또는 `Superuser`
  - `me.isGuest`이면 `Guest (읽기)`
  - 그 외는 모두 `User`
- 따라서 `d_superuser`는 실제 역할이 있어도 `isAdmin=false`, `isGuest=false`라서 최종 fallback인 `User`로 표시됩니다.

## 수정 계획

1. `useCurrentUser.ts` 역할 판정 전면 정리
   - `d_superuser` 전용 플래그(`isDSuperUser`)를 계속 유지합니다.
   - `isAdmin`은 기존 의미를 유지할지, 또는 관리자 메뉴 접근까지 포함할지 명확히 분리합니다.
   - 표시용 대표 역할(`primaryRole`)과 표시 라벨(`roleLabel`)을 rank 기준으로 계산하도록 추가합니다.
   - 다중 역할이 있어도 `admin > superuser > d_superuser > senior_user > user > super_guest > guest` 우선순위로 대표 역할을 안정적으로 선택합니다.

2. 사이드바 로그인 정보창 표시 수정
   - 현재의 `isAdmin / isGuest / else User` 단순 분기를 제거합니다.
   - `me.primaryRole` 또는 `me.roleLabel` 기반으로 실제 역할을 표시합니다.
   - `d_superuser`는 `D-Super User` 또는 사용자가 보는 명칭 기준 `D.Superuser`로 표시되게 합니다.
   - `guest`만 `Guest (읽기)`로 표시하고, `super_guest`, `senior_user`, `user`도 각각 실제 역할 라벨로 표시합니다.

3. 권한 로직 재검토
   - 메뉴 노출에서 사용하는 `isEditor`, `isAdmin` 의미를 점검합니다.
   - `d_superuser`가 “전체 편집 승격” 역할이라는 기존 정의에 맞게 `editorOnly` 메뉴 접근은 유지합니다.
   - 관리자 메뉴 접근이 `admin/superuser` 전용이어야 하는 기존 정책은 유지하고, 별도 지시 없이 `d_superuser`에게 Admin 메뉴를 열지는 않습니다.

4. 검증
   - DB에서 `서창훈`의 `d_superuser` 역할이 유지되는지 재확인합니다.
   - 브라우저에서 로그인 정보창 표시가 `User`가 아닌 `D.Superuser` 계열로 표시되는지 확인합니다.
   - `isEditor` 기반 메뉴가 계속 정상 노출되는지 확인합니다.

## 기술 세부사항

- 수정 대상 파일:
  - `src/hooks/useCurrentUser.ts`
  - `src/components/layout/AppLayout.tsx`
- DB 마이그레이션은 필요하지 않습니다. 현재 문제는 DB 저장 문제가 아니라 프론트엔드 표시 분기 문제입니다.