# TM 상세페이지 컴팩트 리디자인 계획 (v2)

현재 필드 구성과 7개 그룹(Identification / Task / Status / Plan / Actual / Forecast / System) 분류는 그대로 유지하면서, 시각 밀도·정보 계층·편집 어포던스만 개선합니다. **데스크톱에서 Comments 패널 위치(우측 컬럼)는 현재와 동일하게 유지합니다.**

## 현재 문제점 요약

- 그룹 카드가 세로로만 쌓여 스크롤 길이가 길다 (7개 섹션 × 2열 목록).
- 각 필드가 `label(min-w 110px) + value(px-1.5 py-0.5)` 한 줄 구조라 값이 짧아도 세로 공간을 균등 소비.
- 편집 가능/불가 구분이 배경 음영 하나뿐 → 편집 어포던스가 약함.
- 헤더의 Task No · Discipline · Team · Task Name이 한 줄에 몰려 모바일에서 줄바꿈 붕괴.

## 리디자인 방향 (레이아웃/디자인만, 데이터·권한·필드 셋 변경 없음)

### 1. 헤더 컴팩트화
- 2행 구조:
  - 1행: 뒤로가기 · `Task No`(mono, 큰 글씨) · 편집 상태 뱃지 · Refresh
  - 2행: Discipline / Team / Level / Risk / Status 뱃지 스트립 (`text-[10px] h-5` 통일)
- Task Name은 헤더 아래 한 줄로 분리, `truncate` + 툴팁.
- responsive-layout-patterns의 grid + min-w-0 + shrink-0 패턴 적용.

### 2. 본문 레이아웃 (Comments 위치 유지)
- 최상위 그리드는 현재와 동일하게 `lg:grid-cols-3`, 본문 `lg:col-span-2`, Comments 우측 1컬럼 유지.
- **좌측 본문 내부만** 밀도형 재편:
  - 그룹 카드 내부 그리드를 `md:grid-cols-2 xl:grid-cols-3`으로 확장(카드 자체는 세로 스택 유지).
  - 카드 padding `p-3 → p-2.5`, 헤더 라벨 `text-[10px] uppercase` + 그룹 색상 dot(`GROUP_HEADER_BG` 재사용).
- 필드 리스트를 `<dl>` 시맨틱으로 전환:
  - `dt`: `text-[10px] text-muted-foreground`, 우측 정렬, 고정 `w-[92px]`.
  - `dd`: `text-xs`, `truncate`, hover 시 편집 어포던스 표시.
  - 행 높이 `h-6` 균일 → 세로 밀도 30~40% 개선.

### 3. 편집 어포던스 개선 (권한 로직 불변)
- 편집 가능 필드: hover 시 `ring-1 ring-primary/30` + 우측 미세한 연필 아이콘.
- 편집 불가 필드: 현재의 `bg-muted/60` 대신 `text-muted-foreground/80` + 좌측 `border-l-2 border-dashed border-muted pl-1.5` 인디케이터.
- Owner 전용(Team / Data Date)은 좌측에 `key` 아이콘으로 "권한 편집" 표기.

### 4. 값 표현 정제
- `date`: `formatDdMmm` 유지, `font-mono tabular-nums` 통일.
- `percent`: 숫자 + 얇은 프로그레스 바(`h-1 bg-muted` / `bg-primary`)를 값 아래 병기 (Actual %, Plan %, T.Actual 등). 데이터 변경 없음.
- `boolean`: Yes/No를 Check/X 아이콘으로 축약.
- 빈 값 `—`을 `text-muted-foreground/40 text-[10px]`로 낮은 강조.

### 5. Comments 사이드바 (데스크톱 위치 유지)
- 데스크톱(lg 이상): 현재 그리드의 우측 컬럼 위치 그대로 유지. 다만 카드에 `sticky top-4 max-h-[calc(100vh-6rem)] overflow-auto`만 추가하여 긴 본문 스크롤 시에도 함께 보이도록 개선(위치 자체는 이동 없음).
- 모바일(lg 미만): 현재와 동일하게 본문 하단으로 자연 배치.

### 6. 반응형 & 접근성
- 모바일(<768): 그룹 카드 1열, 필드 라벨 상단·값 하단 스택으로 자동 전환.
- 모든 편집 셀에 `role="button"` + `aria-label="{label} 편집"`.
- 헤더/뱃지 스트립에 `flex-wrap gap-1.5` + shrink-0 유지.

## 기술 세부

- 수정 파일: `src/components/task-management/detail/TaskDetailPage.tsx` 단일. `EditCellPopover`, `columns.ts`, 서버 함수, 훅은 변경 없음.
- 같은 파일 내 하위 컴포넌트로 분리:
  - `DetailHeader({row})`
  - `GroupCard({group, cols, row, ...perm})`
  - `FieldRow({col, value, editable, onSave})` — dl/dt/dd 렌더링.
  - `PercentValue({value})` — 숫자 + 미니 progress bar.
- semantic 토큰(`bg-card`, `text-muted-foreground`, `bg-primary`, `ring-primary/30`)만 사용. 하드코딩 색상 금지.
- 그룹 강조 색상은 기존 `GROUP_HEADER_BG` 재사용.

## 예상 레이아웃 (데스크톱 lg+)

```text
┌───────── Header (2 rows) ─────────┐
│  ← 목록  TASK_NO  [편집]  [Refresh]│
│  [Disc][Team][Lvl][Risk][Status]  │
│  Task Name                        │
└───────────────────────────────────┘
┌──── Body (col-span-2) ────┐┌ Comments ┐
│ [ID][Task][Status]        ││ sticky   │
│ [Plan][Actual][Forecast]  ││ (우측    │
│ [System                  ]││  유지)   │
└───────────────────────────┘└──────────┘
```

## 비변경 항목

- 필드 목록, 라벨(`useTmColumnLabel`), 그룹 분류, 편집 권한 규칙, `EditCellPopover` 동작, `renderFieldValue` 데이터 해석.
- Comments 스레드 컴포넌트/카테고리, **데스크톱 우측 배치**.
- 라우팅, 쿼리 키, 서버 함수.

## 다음 단계

승인 시 `TaskDetailPage.tsx` 한 파일만 리팩터하여 위 컴팩트 레이아웃을 적용하고, 모바일·데스크톱 두 뷰포트에서 스크린샷으로 회귀 검증합니다.
