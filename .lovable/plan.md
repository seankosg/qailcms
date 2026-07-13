## Defect Import: 파일의 Team 값 우선, 비어있을 때만 Category 자동 판별

### 배경 (정책 변경)

이전에는 "Category → Team 자동 매핑이 절대 우선, 파일의 Team 컬럼은 무시"였습니다. 이번 지시로 규칙을 아래처럼 변경합니다.

- **파일의 Team 컬럼에 값이 있으면 → 그 값을 그대로 사용** (자동 판별 스킵).
- **파일의 Team 컬럼이 비어 있거나 컬럼 자체가 없을 때만 → Category → Team 자동 매핑 수행**.
- 자동 매핑 결과도 없고 파일 값도 없으면 → `team = null`, `unmappedCategories`에 카운트 (기존 그대로).

### 변경 사항

**A. `src/lib/defect-management/parser.ts`**
- `EXTRA_REIMPORT_FIELDS`에 `"team"` 재추가. Re-import 파일의 team 컬럼이 `p.extra.team`으로 정상 파싱되도록.
- 원본(LetsBuild) 파일도 team 컬럼이 있을 수 있으므로, `CANONICAL_HEADERS`에 `team → team`(별칭 `팀`, `assigned_team` 등)을 추가할지는 스코프 밖으로 두고, 기본은 raw 헤더 그대로 정규화 매칭(`normalizeHeader("Team") === "team"`)에 의존. `EXTRA_REIMPORT_FIELDS`에 `team`이 있으면 `toDefectFieldName`이 `"team"`을 반환하므로 `extra.team`에 자동 수집됨.
- 즉 파싱 결과의 `p.extra?.team`이 파일의 team 값이 됨(문자열 정규화 후).

**B. `src/contexts/DefectManagementImportContext.tsx`**
- `payloads` 생성 로직 변경:
  1. `fileTeamRaw = p.extra?.team` 읽기 → trim → `DEFECT_TEAMS`에 포함되면 유효 값으로 채택.
  2. 유효 값이면 `base.team = fileTeam`, 아니면 `resolveTeam(p.category)` 사용.
  3. 최종적으로 team이 여전히 null이고 `p.category`가 있으면 `unmappedCategories`에 카운트(기존 로직 유지).
- `p.extra` 병합 루프의 `if (k === "team") continue;` 가드는 그대로 유지 (위에서 이미 base.team을 세팅했으므로 중복 반영 방지).
- per-row log(`defect_import_row_logs`)의 `team` 필드도 위 우선순위로 계산해 기록.

**C. `src/components/defect-management/import/DefectColumnSelect.tsx`**
- `HDEC_FIELDS` 프리셋에 `"team"` 재추가 (컬럼 선택 다이얼로그에서 team 컬럼을 "유지"로 기본 선택).

**D. `.lovable/plan.md`**
- 정책 변경 요약 반영 (기존 "team 폐기" 문구를 이번 규칙으로 갱신).

### 유효성 판정

`fileTeam` 유효 조건:
- trim 후 빈 문자열이면 무효
- 대소문자 무시 매칭 후 `DEFECT_TEAMS`(`Arch` | `Mech` | `Elec`) 중 하나여야 함 (예: `"arch"` → `Arch`로 정규화)
- 그 외 값(예: 오탈자, 한글 팀명)은 무효 처리 → 자동 매핑 fallback

### DB/스키마

변경 없음. RLS/정책 그대로.

### 산출물

- 수정: `src/lib/defect-management/parser.ts`, `src/contexts/DefectManagementImportContext.tsx`, `src/components/defect-management/import/DefectColumnSelect.tsx`, `.lovable/plan.md`
- 상세 페이지의 team 수동 편집은 그대로 유지.

### 검증

- `bunx tsgo --noEmit`
- Team 컬럼이 있는 Re-import 파일: 파일 값이 그대로 반영되는지 확인.
- Team 컬럼이 없는 원본 파일: Category → Team 자동 매핑이 작동하는지 확인.
- Team 컬럼은 있으나 일부 행만 값이 있는 파일: 값 있는 행은 파일 값, 빈 행은 자동 매핑으로 채워지는지 확인.
