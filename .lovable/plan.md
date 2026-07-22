## 목표
업로드된 `Reference_File_Snagging_1.xlsx`의 두 rule을 SM 임포트 시 자동 적용하고, Settings 페이지에 관리 UI 탭을 신설.

## 규칙 요약
1. **HDEC PIC / HDEC ENG rule** — Plot + Building + (Plan Group ∪ Room Group) 매칭 시 두 필드 채움.
2. **Subcon rule** — Plot + Room Group + Trade 매칭 시 subcontractor_name 채움.
   - Trade: main_trade / sub_trade 정확 일치 우선 → 미매치 시 description 부분일치(OR).
3. **덮어쓰기 금지**: 원본 엑셀에 값이 있거나 기존 DB에 값이 있으면 rule 적용 스킵.
4. **Plot 판정**: `plan_group` 문자열에서
   - "Plot D" 포함 or "Tower 4" → **D**
   - "Plot C" 포함 or "Tower 3" → **C**
   - 그 외 → 미매칭(스킵).

## 1. DB 마이그레이션 (신규 테이블 2개)

### `public.defect_hdec_pic_rules`
- 컬럼: `id uuid pk`, `plot text` (C|D), `building text`, `room_group text`, `hdec_pic text`, `hdec_eng text`, `sort_order int`, `is_active bool default true`, `created_at`, `updated_at`
- UNIQUE (plot, building, room_group)
- GRANT: authenticated SELECT / admin·superuser는 서버 사이드 role 체크 대신 RLS로: `has_any_role({admin, superuser})` INSERT/UPDATE/DELETE, 전 authenticated SELECT
- 초기 seed: 참조 엑셀 Rule A의 11행

### `public.defect_subcon_rules`
- 컬럼: `id uuid pk`, `plot text` (C|D), `room_group text`, `match_mode text` ('trade' | 'description'), `trade_keywords text[]` (main/sub trade 정확 일치용 토큰), `description_keywords text[]` (부분일치용), `subcontractor_name text`, `sort_order int`, `is_active bool default true`, timestamps
- 실제로는 한 rule 안에서 두 매칭 모드를 모두 시도(정확→부분). 그래서 컬럼은:
  - `trade_keywords text[]` (콤마 split된 원본 키워드 목록)
  - `plot`, `room_group`, `subcontractor_name`
- UNIQUE는 두지 않음(같은 plot+room_group에 여러 subcon 있을 수 있음, sort_order로 우선순위)
- GRANT/RLS 동일
- 초기 seed: 참조 엑셀 Rule B의 ~36행 (콤마 분리하여 배열 저장)

## 2. 임포트 로직 확장 (`DefectManagementImportContext.tsx`)

`executeImport` 함수에서 category_team_map fetch 직후:
- 두 rule 테이블을 `.from().select()`로 각각 조회하여 메모리 캐시 구성.
- 유틸 함수 3개 추가:
  - `resolvePlot(planGroup)`: 위 규칙대로 'C'|'D'|null 반환.
  - `resolveHdec(plot, building, planGroup, roomGroup)`: `{pic, eng} | null`. building/room_group은 정확 일치, room_group 매칭 시 plan_group OR room_group 어느 쪽이든 rule.room_group과 일치.
  - `resolveSubcon(plot, roomGroup, planGroup, mainTrade, subTrade, description)`: sort_order 오름차순으로 순회, 각 rule에 대해 (a) plot 일치, (b) room_group ∈ {row.room_group, row.plan_group}, (c) mainTrade/subTrade가 trade_keywords 중 하나와 정확 일치(대소문자·공백 무시) → hit. 없으면 (d) description에 trade_keywords 중 하나라도 substring 포함 → hit. 첫 hit의 subcontractor_name 반환.
- `payloads.map` 내에서 base 조립 후:
  - HDEC PIC/ENG: 원본 값(`p.hdec_pic_name`)이 null이고 기존 DB(`prev?.hdec_pic_name`)도 null일 때만 `put(base, 'hdec_pic_name', resolved.pic)`. (existing 조회에 `hdec_pic_name`, `hdec_eng_name`, `subcontractor_name` 추가.)
  - Subcon도 동일 패턴.

## 3. Settings 페이지 탭 구조

현재 `DefectCategoryTeamMapPage`가 단일 페이지. 이를 shadcn `Tabs`로 감싸는 상위 페이지 신설:

- `src/components/defect-management/settings/SnagListSettingsPage.tsx` (신규)
  - Tabs: `Category → Team` (기존) / `HDEC PIC / ENG` (신규) / `Subcon` (신규)
- `src/components/defect-management/settings/HdecPicRuleTab.tsx` (신규)
  - 테이블 컬럼: Plot(Select C|D) / Building / Room Group / HDEC PIC / HDEC ENG / Actions
  - 추가/편집/삭제 폼, admin·superuser만 편집.
- `src/components/defect-management/settings/SubconRuleTab.tsx` (신규)
  - 테이블 컬럼: Plot / Room Group / Trade Keywords(콤마 입력) / Subcon / Sort / Actions
- 훅 신규: `src/hooks/useDefectHdecPicRules.ts`, `useDefectSubconRules.ts` (list/upsert/delete)
- 라우트 `settings.tsx`: `SnagListSettingsPage`를 렌더하도록 교체.

## 4. 기존 데이터 백필 (선택)

계획: 마이그레이션 별도 단계로, 기존 `defect_items_raw` 중 hdec_pic_name/subcontractor_name이 NULL인 행에 대해 SQL UPDATE로 rule 적용. 
→ 이번 계획에는 **포함하지 않음**. 임포트 시점 자동 채움만 구현하고, 추후 사용자 요청 시 별도 마이그레이션으로 진행.

## 기술 세부

- Trade 키워드 정규화: `s.trim().toLowerCase().replace(/\s+/g,' ')`. 콤마로 split.
- Rule 캐시는 `Map<plot, Rule[]>`로 구조화하여 임포트 행마다 O(rules_per_plot) 스캔.
- RLS: 두 rule 테이블 모두 `SELECT`는 authenticated, 쓰기는 `public.has_any_role(auth.uid(), ARRAY['admin','superuser'])`. `has_any_role` 함수 존재 확인 완료.
- 마이그레이션 SQL 하나로 두 테이블 + GRANT + RLS + 정책 + seed(INSERT) 모두 처리.

## 산출물
- 마이그레이션 1건 (테이블 2 + seed)
- 신규 파일: `SnagListSettingsPage.tsx`, `HdecPicRuleTab.tsx`, `SubconRuleTab.tsx`, `useDefectHdecPicRules.ts`, `useDefectSubconRules.ts`
- 수정 파일: `DefectManagementImportContext.tsx`(rule 조회 + 자동채움 로직 + existing select에 3필드 추가), `settings.tsx`(라우트 컴포넌트 교체)
