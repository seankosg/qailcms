# Phase 4 계획: Import 파이프라인 Team 정합성 · 유사 이름 매칭 · 신규 Team 처리

## 목표

현재 4종 Raw 테이블(ABD, Defect, Task, Spare Part) Import 시 team 값이 `MECH/ELEC/ARCH` 하드코딩으로 처리되고 있음. 이를 `team_master` 기반으로 동적화하고, 파일명/시트 내부에서 감지된 team 코드가 `team_master`에 없을 때 **관리자용 신규 Team 등록 다이얼로그**를 통해 마스터를 확장한 뒤 Import를 진행할 수 있게 합니다. 또한 Subcontractor/Sub-Sub/HDEC PIC/Eng 이름의 오타/공백 차이로 인한 정합성 문제를 유사 매칭으로 완화합니다.

## 1. 파서/감지 로직 동적화

**대상 파일:**
- `src/lib/abd/parser.ts` — `detectTeamFromFilename`, `parseAbdFile`
- `src/lib/defect-management/parser.ts` — team 필드 처리 부분
- `src/lib/task-management/parser.ts` — team 필드 처리 부분
- `src/lib/spare-part-import-parser.ts` — team 필드 처리 부분 (컬럼 부재 시 무시)

**변경 내용:**
- 하드코딩된 `MECH/ELEC/ARCH` 대신 `TeamOption[]`을 파라미터로 받아 매칭 (파일명 대문자화 후 코드 포함 여부 + 별칭 사전 검색).
- `detectTeamFromFilename(name, teamOptions)` — 옵션의 `code`와 별칭 사전(선택 사항: `team_master.aliases jsonb` 또는 정적 매핑 유지)을 우선순위대로 검사.
- 파서는 순수함수 유지 → **호출 측(Import 화면)**에서 `useTeamOptions()`로 옵션을 주입.
- 감지 실패 시 team=null 반환 (기존 `?? "MECH"` fallback 제거).

## 2. Import 사전 검증 파이프라인

**신규 파일:** `src/lib/import/team-validation.ts`
- `collectUnknownTeamCodes(rows, teamOptions): string[]` — 정규화 후 마스터에 없는 코드 목록.
- `normalizeRowsWithTeam(rows, teamOptions)` — canonicalize 결과 반환.

**Import 화면(`/import-log/import`)에서 사용:**
- 파싱 후 → 미등록 team 코드 목록 계산 → 미등록 코드가 있으면 다이얼로그 표시:
  - **관리자(admin/superuser)**: "신규 Team 등록" 다이얼로그 (code, name, sort_order 입력) → `addMasterName("team", ...)` 호출 → team_master invalidate → Import 재시도 안내.
  - **비관리자**: "관리자에게 문의" 안내 후 Import 차단.
- 모든 team 코드가 유효할 때만 Import 진행 (server-side upsert 단계).

## 3. Subcontractor / Sub-Sub / HDEC PIC / Eng 유사 매칭

**신규 파일:** `src/lib/import/fuzzy-master-match.ts`
- `normalizeName(s)` — trim, 다중 공백 축약, 대소문자/전각 통일.
- `matchMasterName(raw, options, threshold=0.85)` — 다음 순서:
  1. 정규화 후 정확 일치
  2. 정규화 후 대소문자 무관 일치
  3. Levenshtein 기반 유사도 (임계값 0.85, 짧은 이름은 편집거리 ≤1)
  → 후보 리스트 반환 (best match + 상위 3개).

**Import 다이얼로그 확장:**
- 미등록 이름이 있으면 각 항목에 대해:
  - 후보가 있으면 "→ (best match) 로 매핑" 옵션과 "신규 등록"(admin only) 옵션 병렬 제공.
  - 후보가 없으면 "신규 등록"(admin) / "차단"(non-admin).
- 매핑 선택 결과를 rows에 재적용 후 서버 upsert 호출.

## 4. team_master 별칭 지원 (선택)

- `team_master` 테이블에 `aliases text[]` 컬럼 추가하지 않고 **정적 매핑 유지**(현재 파일명 감지에서 "설비/전기/건축" 등을 하드코딩 중). 대신 `src/lib/team/team-aliases.ts`에 별칭 사전을 두어 admin이 코드로 편집 가능하게 하고, DB 마이그레이션은 이번 Phase에서는 하지 않음.
- 향후 완전 동적화가 필요하면 별도 Phase에서 `aliases jsonb` 컬럼 도입.

## 5. 사용자에게 확인 필요

**Q1. 별칭(예: "설비→MECH")을 이번 Phase에서 DB로 옮길까요?**
- A. 아니오, `team-aliases.ts` 정적 사전 유지 (기본안, 빠름)
- B. 예, `team_master.aliases text[]` 컬럼 추가하고 마스터 UI에 별칭 편집 탭 추가

**Q2. 유사 매칭 임계값과 자동 적용 범위?**
- A. 임계값 0.85, 사용자가 확인 다이얼로그에서 개별 승인 (기본안, 안전)
- B. 임계값 0.9 이상은 자동 적용, 그 이하만 다이얼로그로 확인
- C. 유사 매칭 없이 정확 일치만 (Phase 4에서 제외)

**Q3. spare_parts_raw team 처리?**
- 현재 컬럼은 추가되었으나 UI/파서 노출은 미정. 이번 Phase에서 파서에도 team 감지 로직을 넣을까요?
- A. 예, 다른 3종과 동일하게 (기본안)
- B. 아니오, 나중 Phase에서 별도 처리

## 6. 검증

- 타입체크: `tsgo`
- 스모크:
  1. team_master에 없는 코드(예: `PLUMB`)가 파일명에 있는 ABD 파일 Import → 다이얼로그 표시 → 관리자로 신규 등록 → 재시도 성공
  2. 오타 있는 Subcontractor(예: "삼성이앤씨" vs "삼성E&C") → 유사 매칭 후보 표시 → 매핑 승인 → 정상 저장
  3. 기존 `MECH/ELEC/ARCH` 파일 회귀 없음
  4. 비관리자가 미등록 team 감지 파일 Import → 차단 및 안내
- Import Logs에 미해결 미등록 코드 목록 기록 (실패 사유로).

## 다음 단계 예고

Phase 5: 각 Raw Data 화면(ABD, Snag, SP, Task)의 Team 필터/편집 UI를 `useTeamOptions()`로 치환 및 `canEditRawRow` 적용.
