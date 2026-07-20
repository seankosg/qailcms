## 현황 확인
- `ABD → Settings` 페이지는 `abd_header_mappings`(Header Mapping)와 `abd_field_config`(Field Config) 두 탭으로 구성 — Admin의 `Mapping` 페이지가 Spare Part / Task Management / Snag List Management에 제공하는 것과 동일한 성격의 관리 화면입니다.
- 다만 현재 Admin > Mapping 페이지에는 ABD 탭이 아직 없어서 "완전한 중복"은 아니고, ABD만 사이드바 별도 진입점(`/closure/abd/settings`)으로 분리되어 있는 상태입니다.

## 목표
ABD Settings를 폐기하고, 동등한 관리 UI를 Admin > Mapping 페이지의 신규 탭으로 통합해 관리 진입점을 Admin 한 곳으로 일원화합니다.

## 변경 사항

### 1) Admin > Mapping에 `As Built Drawing` 탭 추가
- `src/routes/_authenticated/admin/mapping.tsx`의 최상위 `TabsList`에 `as-built` 탭 추가.
- 하위에 `Field Config` / `Header Mapping` 두 하위 탭 구성 (기존 다른 모듈과 동일 패턴).
- 내용물은 기존 `AbdSettingsPage.tsx`의 `HeaderMappingsTable`, `FieldConfigTable`을 각각 `src/components/admin/AbdFieldConfigTable.tsx`, `src/components/admin/AbdHeaderMappingTable.tsx`로 추출하여 재사용.

### 2) ABD Settings 사이드바 항목 및 라우트 제거
- `src/components/layout/AppLayout.tsx`의 As Built Drawing 모듈 items에서 `Settings` 항목 삭제.
- `src/routes/_authenticated/closure/abd/settings.tsx` 파일 삭제.
- `src/components/abd/settings/AbdSettingsPage.tsx` 파일 삭제(내용은 위 1)에서 admin 컴포넌트로 이관됨).

### 3) 잔여 참조 정리
- 프로젝트 내 `AbdSettingsPage`, `/closure/abd/settings` 문자열 참조를 검색해 남아있으면 제거 또는 Admin > Mapping(ABD 탭)으로 링크 교체.

## 검증
- 관리자 계정 로그인 → 사이드바 As Built Drawing 하위에 `Settings` 항목이 사라졌는지 확인.
- `/admin/mapping` 접근 → `As Built Drawing` 탭에서 기존 ABD Header Mapping / Field Config가 동일하게 동작(로드·추가·수정·삭제)하는지 확인.
- 기존 URL `/closure/abd/settings`가 라우트 매치 실패(또는 not-found)로 처리되는지 확인.
- 빌드/타입체크에서 삭제 파일 참조 오류가 없는지 확인.
