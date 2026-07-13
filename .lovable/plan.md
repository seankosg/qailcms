## Defect Import: 팀 선택 로직 완전 폐기

Category→Team 자동 매핑이 항상 우선하도록, 임포트 경로에 남아 있는 팀 관련 잔재를 제거합니다.

### 현재 남은 잔재

1. **`src/lib/defect-management/parser.ts`**
   - `EXTRA_REIMPORT_FIELDS`에 `"team"`이 포함돼 있어 Re-import 파일에 Team 컬럼이 있으면 `p.extra.team`으로 파싱됨.
   - 임포트 컨텍스트에서 `payloads`를 만들 때 auto-resolve된 `team: rowTeam`을 먼저 넣은 뒤 `p.extra`를 병합하므로, 파일의 team 값이 **자동 매핑을 덮어씀** (스펙 위반).
   - 사용되지 않는 `teamHint` 필드/상수도 남아있음.

2. **`src/components/defect-management/import/DefectColumnSelect.tsx`**
   - `HDEC_FIELDS` 프리셋에 `"team"`이 포함돼 있어 컬럼 선택 다이얼로그의 HDEC 프리셋이 여전히 team을 "유지" 컬럼으로 선택함.

### 변경 사항

**A. `parser.ts`**
- `EXTRA_REIMPORT_FIELDS`에서 `"team"` 제거 → 파일의 team 컬럼은 파싱 단계에서 무시(raw_payload에는 남되 canonical 필드로 승격되지 않음).
- `ParseDefectResult.teamHint` 필드 및 `const teamHint = null;` 코드 제거.
- `ParseDefectResult` 반환 객체에서 `teamHint` 프로퍼티 제거.

**B. `DefectColumnSelect.tsx`**
- `HDEC_FIELDS`에서 `"team"` 제거.

**C. `DefectManagementImportContext.tsx`**
- `p.extra` 병합 루프에서 `k === "team"` 이면 건너뛰는 방어 가드 추가 (혹시 다른 경로로 들어와도 auto-team이 절대 덮이지 않도록).
- 안내 문구는 이미 "Team은 Category 자동 매핑"이라 별도 변경 불필요.

### 산출물

- **수정**: `src/lib/defect-management/parser.ts`, `src/components/defect-management/import/DefectColumnSelect.tsx`, `src/contexts/DefectManagementImportContext.tsx`
- DB/라우트/사이드바 변경 없음. 상세 페이지의 team 수동 편집(select) 기능은 **그대로 유지**(임포트 단계에서만 폐기).
