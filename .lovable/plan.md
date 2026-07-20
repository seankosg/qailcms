## 현재 설정

DMR 업로드 권한은 현재 **senior_user 이상**만 허용하도록 설정되어 있습니다.

### 프론트엔드 권한 체크
- `src/hooks/useCurrentUser.ts`의 `canEdit`은 `rank >= ROLE_RANK.senior_user`로 계산됩니다.
- `src/components/resource/dmr/DmrImportPage.tsx` 및 `DmrRawDataPage.tsx`에서 `canEdit`을 기준으로 Import 버튼/화면을 노출합니다.
- 권한이 없을 경우 "임포트 권한이 없습니다 (senior_user 이상)" 메시지를 표시합니다.

### 데이터베이스 RLS 정책
- `dmr_entries`, `dmr_system_master`, `dmr_contractor_master` 테이블의 쓰기(ALL) 정책은 다음 역할 중 하나 이상 보유한 인증 사용자에게만 허용됩니다.
  - `admin`
  - `superuser`
  - `d_superuser`
  - `senior_user`
- 일반 `user`, `super_guest`, `guest` 역할은 DMR Raw Data를 조회할 수는 있으나 업로드/수정/삭제는 불가합니다.

## 계획

이번 요청은 현재 설정을 유지하는 것으로 확인되었으므로, **코드 및 데이터베이스 변경은 수행하지 않습니다.**

- 프론트엔드 `canEdit` 기준 유지
- DMR 관련 테이블 RLS write 정책 유지
- Storage bucket `dmr-uploads` 정책 별도 변경 없음

추후 권한 변경이 필요하시면 `senior_user` 기준을 조정하거나, 특정 역할을 추가/제외하는 방식으로 진행하겠습니다.