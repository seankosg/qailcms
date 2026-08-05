# SM 임포트 "Start import" 버튼 비활성 — 원인 확정 및 수정

## 실측 결과

업로드하신 두 파일은 문제 없습니다. 프리뷰에서 실제로 두 파일을 SM 임포트 화면에 올려 재현한 결과 둘 다 `Ready`(52행 / 330행)로 파싱되고 **버튼이 활성**이었습니다.

- 파서 단독 검증: 날짜 오류 0건, 중복 ID 0건, 모듈 지문 판정 `sm` = ok
- "None" 값 가설은 오판이었습니다(엑셀 셀은 실제로 비어 있음)
- 관리자 계정(고현봉)으로는 정상 작동

## 진짜 원인 — 역할 판정 하드코딩

`src/components/defect-management/import/DefectManagementImportPage.tsx:84-87`

```text
const canImport =
  !!me?.roles?.includes("admin") ||
  !!me?.roles?.includes("superuser") ||
  !!me?.roles?.includes("user");
```

두 분의 실제 역할(DB 실측):

| 사용자 | 역할 | 팀 |
| --- | --- | --- |
| 이남길 | d_superuser | MECH |
| 신민호 | d_superuser | ELEC |

`d_superuser` 가 위 목록에 없어 `canImport = false` → 파일이 Ready 여도 버튼이 회색이고 툴팁은 "권한이 필요합니다" 로 뜹니다.

권한표(`rcl_permissions`) 실측상 `d_superuser` 는 `import` 액션에 대해 own / own_team = 허용, other_team = 불가입니다. 즉 **권한 설정은 이미 맞는데 화면 코드만 옛 하드코딩에 머물러 있는 상태**입니다. 같은 임포트 허브의 TM 탭은 이미 `me.isEditor`(admin·d_superuser·senior_user·user 포함)를 써서 정상입니다.

## 수정 내용

`DefectManagementImportPage.tsx` 한 곳만 바꿉니다.

- `canImport` 를 RCL 정본 판정으로 교체: `useRclGrants("SM", "import")` 결과의 `own || own_team || other_team` 중 하나라도 허용이면 true
- 권한 조회 중(로딩)에는 버튼 비활성 유지, 조회 실패 시 기존과 동일하게 비활성 + 툴팁 표시
- 행 단위 범위 제한(본인/우리팀 행만 반영)은 서버 임포트 필터와 RLS 에서 이미 강제되므로 화면 로직은 추가하지 않습니다

## 검증 방법

1. 타입체크 통과
2. 관리자 세션으로 두 파일 재업로드 → 버튼 활성 유지 확인(회귀 없음)
3. `rcl_grants('SM','import')` 응답이 d_superuser 기준 own/own_team 허용으로 내려오는지 실측
4. 두 분은 운영 사이트를 쓰고 계시므로, 수정 후 **배포(Publish)** 해야 증상이 해소됩니다