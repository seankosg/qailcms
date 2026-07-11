# Task Raw Data — location / floor_level 컬럼 추가

## 목표

- `task_management_raw` 테이블에 `location`, `floor_level` 두 컬럼(text) 추가
- Raw Data 표에서 **Plot 컬럼 오른쪽**에 두 컬럼 표시
- 기존 `level`(parent/child) 컬럼 라벨은 **Tier**로 변경 (필드명은 그대로 `level` 유지 — 코드 영향 최소화)
- 값은 이번 단계에서 채우지 않고 다음 단계에서 채움

## 변경 내역

### 1. DB 마이그레이션
- `ALTER TABLE public.task_management_raw ADD COLUMN location text`
- `ALTER TABLE public.task_management_raw ADD COLUMN floor_level text`
- `task_management_field_config`에 두 필드 시드 (is_visible=true, group_key='task', Plot 뒤 순서)

### 2. 프론트엔드 컬럼 정의 (`src/lib/task-management/columns.ts`)
- `TM_COLUMNS` 배열에서 `plot` 뒤에 두 항목 삽입:
  - `{ key: "location", label: "위치", type: "text", group: "task", editable: true, editorType: "text", width: 130 }`
  - `{ key: "floor_level", label: "층", type: "text", group: "task", editable: true, editorType: "text", width: 90 }`
- `level` 컬럼 label을 `"Level"` → `"Tier"`로 변경

### 3. 타입 / 파서 / 표시 코드
- `src/integrations/supabase/types.ts`는 마이그레이션 승인 후 자동 재생성
- `parser.ts`의 Row 타입에 `location`, `floor_level` optional 필드 추가 (임포트 시 아직 매핑 없음 → null 유지)
- Raw Data 페이지 셀 렌더링은 `TM_COLUMNS` 기반이라 자동 반영, 별도 렌더 분기 불필요
- Bulk edit / 필터 / export도 `TM_COLUMNS` 기반이므로 자동 포함

### 4. Header Mapping / Field Config 관리 페이지
- 자동으로 신규 필드가 목록에 노출됨 (관리자 페이지에서 라벨 오버라이드 가능)

## 다음 단계 (이번 계획 범위 외)

- 임포트 원본 헤더 → `location` / `floor_level` 매핑 규칙 정의
- parent→child 값 동기화 로직에 두 필드 포함 여부 결정
- 값 채우기 (엑셀 재임포트 또는 대량 편집)

## 확인 사항

- `level` 필드명 자체는 유지하고 **표시 라벨만 Tier**로 변경합니다. DB/코드의 `level='parent'|'child'` 로직은 그대로 동작합니다.
- 신규 두 컬럼은 nullable text로 추가되어 기존 행은 NULL 상태로 남습니다.
