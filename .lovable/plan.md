# Phase 4 계획 (확정): Import 파이프라인 Team 정합성 · 유사 매칭 · 신규 Team 등록

사용자 선택 반영: **Q1=B (별칭 DB화), Q2=A (임계값 0.85 + 개별 승인), Q3=A (spare_parts_raw도 파서에 team 감지 포함)**

## 1. DB 마이그레이션 — team_master 별칭 컬럼 추가

- `alter table public.team_master add column aliases text[] not null default '{}'`
- `create index idx_team_master_aliases on public.team_master using gin (aliases)`
- 기존 시딩 데이터 보정 (data 마이그레이션): `MECH → {설비, MECHANICAL}`, `ELEC → {전기, ELECTRICAL}`, `ARCH → {건축, ARCHITECT, ARCHITECTURAL}`
- `validate_team_code` 트리거는 그대로 (code 컬럼만 검증하며 별칭과는 무관).

## 2. Master UI 확장 — 별칭 편집

- `src/routes/_authenticated/admin/masters.tsx` Team 탭에 **별칭(aliases)** 인라인 편집 컬럼 추가
  - 쉼표 구분 문자열 ↔ `text[]` 변환
  - 저장 시 대문자 canonicalize + 중복 제거 + 자기 자신 코드 제외
- `src/lib/admin/users.functions.ts`의 `updateMasterFields`("team")에서 `aliases` 필드 처리 지원

## 3. 신규 유틸리티

- `src/lib/team/team-master.ts`에 확장
  - `TeamOption` 인터페이스에 `aliases: string[]` 추가
  - `matchTeamCode(raw, options)` — 코드 정확 일치 → 별칭 일치(대소문자 무관) 순서로 매칭
  - `detectTeamFromText(text, options)` — 파일명/시트값에서 옵션의 code나 aliases가 포함되는지 검사
- `src/lib/import/fuzzy-master-match.ts` **신규**
  - `normalizeName(s)` — trim, 다중 공백 축약, 전각→반각, casefold
  - `levenshtein(a, b)` — 순수 함수
  - `similarity(a, b) → 0..1` — 편집거리 기반
  - `matchMasterName(raw, options, {threshold=0.85})` → `{ exact: MasterOption | null, candidates: Array<{option, score}> }` (상위 3개)
- `src/lib/import/team-validation.ts` **신규**
  - `collectUnknownTeamCodes(rows, teamOptions)`
  - `canonicalizeTeamOnRows(rows, teamOptions)` — 정규화 결과와 unknown 목록 동시 반환

## 4. 파서 동적화

**4종 모두** `TeamOption[]`을 파라미터로 받도록 서명 변경:

- `src/lib/abd/parser.ts`
  - `detectTeamFromFilename(name, teamOptions)` — 하드코딩된 MECH/ELEC/ARCH 검사 제거, `detectTeamFromText` 위임
  - `parseAbdFile(file, teamOptions, teamOverride?)`
  - `?? "MECH"` fallback 제거 → team=null 허용 후 검증 단계에서 처리
- `src/lib/defect-management/parser.ts` — team 감지에 옵션 주입, 하드코딩 제거
- `src/lib/task-management/parser.ts` — 동일
- `src/lib/spare-part-import-parser.ts` — 헤더에 team 컬럼이 있으면 감지·정규화 (컬럼 부재 시 무시)

## 5. Import 화면 확장

`/import-log/import` (또는 각 도메인별 import 진입점):

- `useTeamOptions()` 훅 사용해 파서 호출 시점에 옵션 주입
- 파싱 후 파이프라인:
  1. **team 검증**: 미등록 코드 목록 계산 → 있으면 `TeamRegisterDialog` 표시
     - admin/superuser: 신규 등록 폼(code, name, sort_order, aliases) → `addMasterName("team", ...)` → invalidate → 재계산
     - 비관리자: "관리자에게 문의" 배너 표시 후 Import 차단
  2. **마스터 이름 정합성**: Subcontractor / Sub-Sub / HDEC PIC / Eng 대상으로 `matchMasterName` 실행
     - 정확 일치는 자동 통과
     - 유사 후보(score ≥ 0.85)가 있으면 `MasterMappingDialog`에서 사용자가 개별 승인
       - "이 후보로 매핑" / "신규 등록"(admin) / "건너뛰기(원본 유지)"
     - 후보 없으면 admin은 신규 등록, 비관리자는 원본 유지 경고
  3. rows 재작성 후 서버 upsert 호출
- `Import Logs`(각 도메인의 `*_import_logs`) 사유 필드에 미해결 team/master 목록 기록

**신규 컴포넌트**
- `src/components/import/TeamRegisterDialog.tsx`
- `src/components/import/MasterMappingDialog.tsx`

## 6. 검증

- 타입체크: `tsgo`
- 스모크:
  1. 파일명에 `PLUMB` 포함된 ABD 파일 → 다이얼로그에서 신규 team `PLUMB` (별칭 `배관`) 등록 → 재시도 성공
  2. 별칭 `설비` 포함 파일 → team=MECH로 자동 매칭
  3. 오타 Subcontractor(`삼성이앤씨` vs `삼성E&C`) → 유사 후보 표시 → 사용자 승인 → 정상 저장
  4. 비관리자가 미등록 team 감지 파일 Import → 차단 및 안내
  5. 기존 `MECH/ELEC/ARCH` 파일 회귀 없음

## 실행 순서

1. **마이그레이션**: `team_master.aliases` 컬럼 + 인덱스 + 기존 3건 데이터 보정
2. `team-master.ts` 확장, `fuzzy-master-match.ts`/`team-validation.ts` 신규
3. Master UI(Team 탭) 별칭 편집 추가
4. 4종 파서 서명 및 감지 로직 동적화
5. Import 화면 파이프라인 + 2종 다이얼로그
6. 타입체크·스모크

## 다음 단계 예고

Phase 5: 각 Raw Data 화면(ABD, Snag, SP, Task)의 Team 필터/편집 UI를 `useTeamOptions()`로 치환 및 `canEditRawRow` 적용.
