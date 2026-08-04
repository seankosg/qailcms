# 권한(RCL) 운영 메모

기준 시점: 2026-08-04 (Asia/Qatar)

## 이름 정규화 정본

- 정본 함수는 `public.hdec_name_norm(text)` 하나뿐이다.
  `upper(btrim(regexp_replace(name, '\s+', ' ', 'g')))`
- `profiles.name_norm` 생성 컬럼도 이 함수를 호출한다(2026-08-04 교체).
  이전 인라인 식(`upper(regexp_replace(btrim(name), ...))`)은 탭·개행이 앞뒤에 있을 때
  결과가 갈렸다. 교체 전후 37행 전건 값 동일함을 확인했다.
- DB 내 인라인 복제는 0건(2026-08-04 실측). 새 함수/뷰에서 식을 다시 적지 말고
  `hdec_name_norm()` 을 호출할 것.

## SPL · WRT — "본인 것" 이 성립하지 않음

- 2026-08-04 실측: `spl_items` 281행, `wrt_items` 339행. 두 테이블 모두
  담당자 컬럼(`pic`, `eng`) 값이 **전건 비어 있음**(0건 채워짐).
- 따라서 두 모듈에서 RCL 표의 **Own 열은 항상 0**이며, 편집 권한은
  주관팀(PRJC) 규칙과 superuser 이상 역할로만 움직인다.
- PRJC 팀 계정 수: **5명** (2026-08-04, 전체 profiles 37명 중).
  0명이 아니므로 PRJC 규칙 경로는 살아 있다.
- 담당자 컬럼 백필 계획은 미정(지시자 판단 대기).

## 계정 · 명부 연동

- 명부(`hdec_eng_name_master` / `hdec_pic_name_master`) 행에서 계정을 생성하면
  `name` 은 명부 대표 이름으로 고정되고, 생성 직후
  `hdec_recalc_owner_for_user(user_id, 'account_create')` 가 자동 호출되어
  5개 모듈의 `owner_user_id` 를 재계산한다. 결과는
  `hdec_name_propagation_log` 에 `source='account_create'` 로 남는다.
- 명부의 `linked_user_id` 는 계정 삭제 시 자동 해제된다(FK ON DELETE SET NULL).
- 이름 병합·통합·오기 정정은 자동화하지 않는다. 화면은 재료(등장 건수·유사 표기 후보)만
  제공하고 판단은 관리자가 한다.
