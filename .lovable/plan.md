
## 목표
Defect 임포트 시 각 행의 `Category` 값에 따라 `team` 컬럼을 자동으로 채웁니다. 매핑 규칙은 DB 테이블로 관리하고 관리자용 Settings UI에서 편집 가능하도록 합니다. 팀 이름은 **Arch / Mech / Elec** 3종으로 통일하고, 상세 페이지에서 team을 수동으로 수정할 수 있게 합니다.

## 1. Team 명칭 통일 (건축/설비/전기 → Arch/Mech/Elec)
`src/lib/defect-management/columns.ts` 의 `DEFECT_TEAMS` 를 `["Arch","Mech","Elec"] as const` 로 변경. `TEAM_COLORS`, `CATEGORY_TO_TEAM`, `TEAM_LABEL`(신설, 화면 표시용 한글 매핑 필요시), 그리고 아래 참조 지점 전부 일괄 변경:
- `src/components/defect-management/**` 내 team 필터/뱃지/BulkEdit/상세페이지
- `src/hooks/useDefectItems.ts` team 필터 값
- `src/lib/defect-management/mutations.functions.ts`, `parser.ts`
- `src/components/defect-management/import/DefectManagementImportPage.tsx` (팀 선택 UI 제거 — 아래 3항 참조)

기존 DB 데이터의 team 문자열('건축'/'설비'/'전기')은 손대지 않지만, UI 표시 호환을 위해 `TEAM_LABEL_MAP: {건축:"Arch", 설비:"Mech", 전기:"Elec"}` 기반 정규화 함수 `normalizeTeam()` 을 조회 결과 렌더링 시에만 적용합니다(요청상 "기존 데이터는 손대지 않음" 유지).

## 2. DB: 매핑 테이블 + RPC
새 테이블 `defect_category_team_map`:
- `category text primary key`, `team text not null check (team in ('Arch','Mech','Elec'))`, `updated_at`, `updated_by`
- GRANT: authenticated SELECT/INSERT/UPDATE/DELETE, service_role ALL
- RLS: 전 authenticated 사용자 SELECT 가능, 관리자(has_role admin/manager)만 write
- 시드 데이터(upsert):
  - Arch: `Architectural`, `Architecture`, `Structural`, `Civil`, `Façade`, `Facade`, `Acoustics`, `Quality`
  - Elec: `Electrical`, `MEP-Electrical`, `MEP-ELV`
  - Mech: `Mechanical`, `MEP-Mechanical`, `Plumbing`, `Fire Fighting`, `Gas`
- 트리거로 `updated_at` 갱신

## 3. Import 파이프라인 변경
- **팀 수동 선택 UI 제거**: `DefectManagementImportPage.tsx` 에서 파일별 팀 선택 셀렉트와 `teamHint` 관련 코드 삭제. 임포트 요청 페이로드에서 `team` 파라미터 제거.
- **파서**: `parser.ts` 는 그대로 `category` 를 각 행에 채우고, `teamHint` 계산은 삭제(또는 categorySummary 만 유지).
- **서버 함수** `mutations.functions.ts` 의 배치 임포트에서:
  1. 함수 시작 시 `defect_category_team_map` 을 한번 조회하여 `Map<string,string>` 캐시.
  2. 각 행 upsert 직전 `row.team = map.get(row.category?.trim()) ?? null` 설정.
  3. 매핑 미존재 category 는 `import_log.warnings` 에 `unmapped_categories: {cat: count}` 로 집계 저장.
- 기존 데이터는 건드리지 않음(요청대로).

## 4. Settings UI (관리자)
`src/components/defect-management/settings/DefectCategoryTeamMapPage.tsx` 신설, 라우트 `src/routes/_authenticated/closure/defect-management/settings.tsx`:
- 테이블 뷰: Category / Team(Select: Arch/Mech/Elec) / Updated / 편집·삭제
- 상단: 새 규칙 추가 (Category 입력 + Team 선택)
- "최근 임포트에서 감지된 미매핑 category 자동 표시" 배너 (선택 규칙 즉시 등록 가능)
- 기존 `AbdSettingsPage` UI 톤 재사용
- 사이드바 메뉴 `Defect Settings` 추가

## 5. 상세 페이지 team 편집
`DefectDetailPage.tsx` 의 team 뱃지 옆에 편집 팝오버 부착:
- 기존 `EditCellPopover` 재사용, editorType `select`, options `['Arch','Mech','Elec']`
- 저장 → `updateDefectField({ id, field:'team', value })`
- Raw Data 페이지 team 컬럼도 select 편집 허용 (`columns.ts` 정의에 `editable:true, editorType:'select'` 추가)

## 6. 변경 요약
**DB 마이그레이션 1건**: `defect_category_team_map` 생성 + 시드 + RLS + GRANT

**신규 파일**
- `src/components/defect-management/settings/DefectCategoryTeamMapPage.tsx`
- `src/hooks/useDefectCategoryTeamMap.ts`
- `src/lib/defect-management/category-team-map.functions.ts` (조회/upsert/delete server fn)
- `src/routes/_authenticated/closure/defect-management/settings.tsx`

**수정 파일**
- `src/lib/defect-management/columns.ts` (팀명 3종 변경, TEAM_LABEL 매핑, editable team)
- `src/lib/defect-management/parser.ts` (teamHint 제거)
- `src/lib/defect-management/mutations.functions.ts` (import 시 map 기반 team 자동 설정 + unmapped 집계)
- `src/components/defect-management/import/DefectManagementImportPage.tsx` (팀 셀렉트 UI 제거)
- `src/components/defect-management/detail/DefectDetailPage.tsx` (team 편집 팝오버)
- `src/components/defect-management/raw-data/*` (팀 필터/뱃지 라벨 정규화)
- `src/components/layout/AppLayout.tsx` (Defect Settings 메뉴)

## 비포함(추후)
- 기존 defect 행의 team 백필(요청상 제외)
- Team 다국어 라벨 커스터마이징(현재는 코드 상수)
