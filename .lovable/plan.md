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

## ABD 임포트 게이트 확인 (지시 2)

`AbdImportPage.tsx:245` 의 `isAdmin || isSuperUser` 는 변수명 그대로 **`canRegisterTeam` — 팀 등록 다이얼로그 전용**이며 임포트 시작 게이트가 아닙니다(시작 버튼은 706행 `disabled={isRunning || readyCount === 0}` 로 권한 조건 자체가 없음). 따라서 이번 수정 대상에서 제외합니다.

## 수정 내용

`DefectManagementImportPage.tsx` 한 곳만 바꿉니다.

- `canImport` 를 RCL 정본 판정으로 교체: `useRclGrants("SM", "import")` 결과의 `own || own_team || other_team` 중 하나라도 허용이면 true
- 권한 조회 중(로딩)에는 버튼 비활성 유지, 조회 실패 시 비활성 + 사유 툴팁
- **툴팁에 실제 판정값을 적습니다**(지시 1). 예: `역할 d_superuser · SM import 권한 없음 (own=N / own_team=N / other_team=N)`. 역할 미확인이면 `역할 없음 · SM import 권한 없음`, 조회 실패면 그 에러 문구를 그대로 노출합니다.

### 범위 제한의 실제 근거 (지시 3 — 사실 정정)

`defect_items_raw` 의 RLS 는 범위를 막지 않습니다(실측):

| 정책 | 조건 |
| --- | --- |
| defect_raw_insert / defect_raw_update | `has_any_role(uid, [user, senior_user, superuser, d_superuser, admin])` — 역할 목록만 확인 |
| defect_raw_select_authenticated | `true` |

즉 본인/우리팀/타팀 구분을 실제로 강제하는 것은 **`rcl_import_filter` 하나뿐**입니다. 화면 버튼은 진입 게이트일 뿐이고, 행 단위 차단은 전송 전 서버 판정(`rcl_import_filter`)에 의존합니다 — 이 경로는 이미 임포트 실행부에 붙어 있으므로 이번 변경에서 건드리지 않습니다.

## 검증 방법

1. 타입체크 통과
2. 관리자 세션으로 두 파일 재업로드 → 버튼 활성 유지 확인(회귀 없음)
3. `rcl_grants('SM','import')` 응답이 d_superuser 기준 own/own_team 허용으로 내려오는지 실측
4. 툴팁 문구에 역할·scope 판정값이 실제로 찍히는지 화면 확인
5. 두 분은 운영 사이트를 쓰고 계시므로, 수정 후 **배포(Publish)** 해야 증상이 해소됩니다