# Team 이름 영문 코드 일괄 전환 계획

## 목표
앱 전반의 팀 값을 대문자 영문 코드로 통일하고, 기존 DB의 한글 데이터도 이번에 일괄 변환. 단, Excel 임포트 파서는 한글 헤더/값도 계속 인식하여 영문 코드로 정규화.

## 표준 코드 매핑
- 건축 → **ARCH**
- 설비 → **MECH**
- 전기 → **ELEC** (기존 데이터 존재. 사용자 지시 목록에는 없으나 그대로 통일 유지)
- 설계 → **DESN** (신규)
- 공무 → **PRJC** (신규)

저장 형식은 전부 대문자. 기존 PascalCase(`Arch`/`Mech`/`Elec`)와 소문자(`elec`)도 모두 대문자로 정규화.

## 현재 DB 상태 (조사 결과)
| 테이블 | 컬럼 | 현재 값 |
|---|---|---|
| `task_management_raw` | `team`, `discipline` | 건축/설비/전기 |
| `defect_items_raw` | `team` | Arch/Elec/Mech |
| `abd_items_raw` | `team` | elec |
| `defect_category_team_map` | `team` | Arch/Elec/Mech |

## 변경 범위

### 1. DB 마이그레이션 (일회성 UPDATE)
`supabase--insert` 로 실행:
- `UPDATE task_management_raw SET team = CASE team WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' END, discipline = CASE discipline WHEN '건축' THEN 'ARCH' WHEN '설비' THEN 'MECH' WHEN '전기' THEN 'ELEC' END`
- `UPDATE defect_items_raw SET team = UPPER(team)` (Arch→ARCH …)
- `UPDATE abd_items_raw SET team = UPPER(team)` (elec→ELEC)
- `UPDATE defect_category_team_map SET team = UPPER(team)`
- `hdec_pic_master`, `subcontractor_master`, `task_management_status_history`, `defect_status_history`, `spare_part_status_history`, `spare_parts_raw`, 각종 `*_change_log`, `*_import_row_logs` — `team` 컬럼 존재 여부 스캔 후 동일 방식 UPDATE (스캔은 build 모드 진입 시 실행)

CHECK 제약이 있으면 마이그레이션(스키마)로 먼저 완화. `task_management_raw.discipline`은 코드 상 zod enum(`["건축","전기","설비"]`)으로 하드코딩돼있어 코드 수정 필수.

### 2. 상수·타입·zod enum 교체
- `src/lib/task-management/columns.ts` — `DISCIPLINES = ["ARCH","ELEC","MECH","DESN","PRJC"] as const`, `TEAM_COLOR_MAP` 키 교체
- `src/lib/task-management/rollup.functions.ts` — zod `z.enum` 3곳 교체 (파라미터도 영문 코드 수신)
- `src/lib/task-management/import-preflight.functions.ts` — `DISCIPLINES` 상수 교체
- `src/lib/task-management/hierarchy.functions.ts` — 동일
- `src/lib/task-management/parser.ts` — `disciplineFromCategoryCode`가 반환하는 값을 `"ARCH"`/`"ELEC"`/`"MECH"`로 교체 (한글 → 코드)
- `src/lib/abd/columns.ts` — `TEAM_LABEL` 값은 그대로 한글 유지하되 **키는 대문자**로 (`ARCH`/`MECH`/`ELEC`) — 라벨 표시 정책은 아래 5.
- `src/lib/defect-management/columns.ts` — 레거시 라벨 정규화 맵을 `{"건축":"ARCH", …, "Arch":"ARCH"}`로 확장, 색상 맵 키 대문자
- 사용처 호출부(예: `TaskManagementRawDataPage.tsx`의 `rollupFn({ data: { discipline: "건축" } })` × 2, `TaskTreePage.tsx`의 `useState<Discipline>("건축")`, `TaskManagementImportContext.tsx` 3곳의 기본값) 모두 `"ARCH"` 로 교체

### 3. Import 파서 — 한글 인식 로직 유지 (사용자 지시 반영)
- `src/lib/abd/parser.ts` — `건축/설비/전기` 문자열 감지 로직 **유지**하되 반환은 대문자 코드
- `src/lib/task-management/parser.ts` — 카테고리 접두 코드 A/M/E → 대문자 코드로 반환. 헤더/파일명 한글 매칭 로직 유지
- 임포트 파일명 감지, 시트명 감지, `disciplineHint` 계산 로직 모두 한글 입력을 영문 코드로 정규화하도록 통일 (내부 저장 값은 항상 대문자)
- 신규 코드 DESN/PRJC 매칭 키워드: `설계`/`DESIGN`/`DESN` → DESN, `공무`/`PROJECT`/`PJT`/`PRJC` → PRJC (추후 임포트 대비)

### 4. UI 라벨 표시 정책
`TEAM_LABEL` 단일 소스에서 관리:
```ts
export const TEAM_LABEL = {
  ARCH: "ARCH", MECH: "MECH", ELEC: "ELEC", DESN: "DESN", PRJC: "PRJC"
} as const;
export const TEAM_LABEL_KO = {
  ARCH: "건축", MECH: "설비", ELEC: "전기", DESN: "설계", PRJC: "공무"
};
```
- 표에 표시되는 배지/필터/드롭다운 라벨은 **영문 코드만** 노출 (예: "ARCH", "MECH")
- 배지에 한글 툴팁 부착 (마우스 오버 시 "건축" 등)
- 사용처: `AbdRawDataPage.tsx`, `AbdImportPage.tsx`, `DefectCategoryTeamMapPage.tsx`, `TaskManagementImportPage.tsx`, `TaskTreePage.tsx`, task/defect Raw Data 페이지의 team/discipline 배지·필터

### 5. 안내 문구 업데이트
- `AbdImportPage.tsx`의 "설비/전기/건축" 문구 → "MECH/ELEC/ARCH"
- `TaskManagementImportPage.tsx`의 "건축/전기/설비" → "ARCH/ELEC/MECH"
- `DefectCategoryTeamMapPage.tsx`의 "Arch(건축) · Mech(설비) · Elec(전기)" → "ARCH · MECH · ELEC" (툴팁에 한글 병기)

### 6. 검증
- `bunx tsgo --noEmit` 타입 체크 통과
- 마이그레이션 후 각 테이블 `DISTINCT team/discipline` 재조회
- 프리뷰: Task Raw Data, Snag Raw Data, ABD Raw Data, Task Tree, Import 페이지에서 배지·필터 정상 표시
- Task Management 임포트에 한글 헤더 파일 넣어 정상 정규화 확인

## 미확정 사항 (건드리지 않는 편이 안전한 항목)
- `defect_category_team_map`의 `category` 컬럼(Architectural/Mechanical/…) — 원본 헤더 문자열이므로 **한글화하지 않음**
- Excel Export 파일 내부의 team 셀 표기 — 코드 기준으로 export (한글 병기 원하면 별도 지시 필요)

승인 후 build 모드에서:
1. 코드 수정 (2·3·4·5)
2. `supabase--insert`로 DB UPDATE (1)
3. 타입 체크 & 프리뷰 검증
순으로 진행.
