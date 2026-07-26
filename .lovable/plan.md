## 목표
ABD 임포트 페이지를 탭 대신 **토글 스위치(Import HDEC / Import Aconex)** 로 개편하고, 토글에 따라 대상 필드 목록이 바뀌는 컬럼 선택 UI를 SM과 동일한 방식으로 사용한다. Mapping 메뉴의 ABD 하위에 SM Preset 탭과 동일한 방식의 Preset 탭을 HDEC / Aconex 각각 하나씩 추가한다.

## 1. Import 페이지 개편 (`src/components/abd/import/AbdImportPage.tsx`)

- 상단 `Tabs` 제거. 대신 헤더 우측에 shadcn `Switch` + 라벨 (`Import HDEC` ↔ `Import Aconex`) 배치. 상태는 `mode: "hdec" | "aconex"`, 기본값 `hdec`.
- 파일 드롭존 하나로 통합. 모드에 따라 파서 및 후속 UI 분기:
  - **HDEC 모드**: 기존 Normal Import 로직(파일별 팀 감지·듀플리케이션·DateIssuesPanel·MasterMappingSection·팀 미등록 알림·`importAbdBatch`) 그대로.
  - **Aconex 모드**: 기존 `AbdAconexImportPage`의 파싱/프리뷰 흐름 재사용 (별도 컴포넌트 유지, `hideHeader` 유지).
- **대상 필드 선택 UI 통일**: 기존 Aconex 탭에 있던 체크박스 카드(`Sync 대상 필드 선택`) 를 공용 컴포넌트로 사용하여 두 모드 모두 노출.
  - HDEC 모드 필드 옵션: `useAbdFieldConfig()` 의 활성 필드 전체(라벨은 `display_name`, 정렬은 `sort_order`) → 체크 해제한 필드는 임포트 시 payload에서 제외(`excluded_fields` prop 을 `importAbdBatch`에 전달, 서버는 patch 조립 시 필터). 기본값 = 전체 선택.
  - Aconex 모드 필드 옵션: 기존 6개(`ACONEX_SYNC_OPTIONS`) 유지, 로직 그대로.
- 프리셋 버튼: 대상 필드 선택 카드 상단에 "프리셋" 드롭다운(또는 버튼 그룹) 배치. 모드에 맞는 preset 목록만 노출하고 클릭 시 해당 preset 의 `fields` 로 체크 상태 교체. `abd_import_presets` 를 useQuery 로 조회, `mode` 컬럼으로 필터.

## 2. Mapping — Preset 탭 추가 (`src/routes/_authenticated/admin/mapping.tsx`)

- ABD 하위 TabsList 에 `HDEC Preset`, `Aconex Preset` 두 개 탭 추가 (SM의 Preset 탭과 동일 위치·동일 컴포넌트 형태).
- 신규 컴포넌트 `src/components/admin/AbdImportPresetTable.tsx` 를 생성. `mode` prop (`"hdec" | "aconex"`) 을 받아 하나의 컴포넌트가 두 탭 모두 렌더링.
- SM `DefectImportPresetTable` 을 기준으로 그대로 이식:
  - 조회/추가/저장/삭제/순서 이동 로직 동일.
  - 필드 선택 팝오버의 옵션 소스만 mode 별로 교체 (`hdec` = ABD Field Config, `aconex` = 6개 상수).
  - 편집 권한 = admin / d_superuser.

## 3. DB — `abd_import_presets` 신규 테이블

마이그레이션으로 생성:

```text
public.abd_import_presets
- id uuid PK default gen_random_uuid()
- mode text NOT NULL CHECK (mode IN ('hdec','aconex'))
- label text NOT NULL
- fields text[] NOT NULL DEFAULT '{}'
- sort_order int NOT NULL DEFAULT 0
- created_at timestamptz default now()
- updated_at timestamptz default now()
```

- 인덱스: `(mode, sort_order)`.
- GRANT: `authenticated` = SELECT/INSERT/UPDATE/DELETE, `service_role` = ALL.
- RLS ON. 정책:
  - SELECT: 로그인 사용자 전체 (`auth.uid() IS NOT NULL`) — SM과 동일한 열람 범위.
  - INSERT/UPDATE/DELETE: `is_admin_or_super(auth.uid())` 또는 `has_role(auth.uid(),'d_superuser')`.
- `set_updated_at` 트리거 재사용.

## 4. 서버 함수 확장

- `src/lib/abd/mutations.functions.ts` 의 `importAbdBatch` 입력 스키마에 `excluded_fields?: string[]` 옵션 추가. 핸들러에서 upsert patch 조립 시 이 목록에 포함된 필드는 payload 에서 제거(기존 DB 값 보존). `abd_number`, `plot`, `team` 등 시스템 키는 제외 대상에서 강제 필터링.
- Aconex 측은 기존 `apply_fields` 로직 그대로 사용.

## 5. 부수 정리

- `AbdImportPage` 에서 사용하지 않게 된 `Tabs*` import 정리.
- 헤더 문구를 새 모드 설명으로 갱신 ("토글에서 HDEC/Aconex 선택 · Aconex 는 기존 항목만 UPDATE").
- 타입/린트 통과 확인.

## 기술 세부

- Preset 필드 옵션 소스는 `useAbdFieldConfig` 훅 그대로 사용 (이미 존재).
- Switch 컴포넌트: `@/components/ui/switch` (shadcn 프로젝트 기본). 없으면 shadcn add.
- 프리셋 적용은 클라이언트 상태만 갱신하고 임포트 시 서버로 `excluded_fields` 전달.
- Aconex 서버 함수는 변경 없음(이미 `apply_fields` 지원).

## 검증

- 타입체크(자동).
- Mapping 화면에서 ABD → HDEC Preset / Aconex Preset 탭이 SM 프리셋 UI와 동일하게 렌더링되는지 육안 확인.
- Import 페이지 토글 전환 시 대상 필드 카드가 HDEC 전체 필드 ↔ Aconex 6개로 정확히 교체되는지, 프리셋 적용이 반영되는지 확인.
