## 목표
TM Dashboard 상단 영역에 흩어져 있는 4개 컨트롤(Data Date / 담당자축 필터 / 지연 필터 / Task 필터)을 하나의 통합 툴바로 재배치해 화면 세로 공간을 절약하고 시선 흐름을 정리한다. 필터 형태는 최대한 유지하되, 공간 효율을 위해 일부만 형태 변경.

## 현재 배치 (3영역 분산)
```text
[Header]     제목 + Data Date Select + "최신" 버튼
[Toolbar]    OwnerQuickFilterPills(담당자축) | 지연 필터 Tabs | (우측) 검색 Input
[KPI 상단]   Task Filter(All/Main/Sub) | Discipline 토글 | items 카운트
```
문제: Data Date와 Task Filter가 서로 다른 층에 있고, 툴바-Header 사이 여백이 이중으로 발생.

## 신규 배치 (단일 sticky 툴바)
```text
[Header 1행]  ← 제목 · (우측) items 카운트만 유지
[Toolbar Card, sticky top]
  ┌ 좌측(축·범위) ────────────────┐  ┌ 중앙(필터) ─────────────┐  ┌ 우측(검색) ┐
  │ 📅 Data Date [Popover]  |     │  │ Task: [All|Main|Sub]     │  │ 🔍 검색     │
  │ 담당자축 Pills(Team/PIC/Eng) │  │ Discipline: [ARCH...SUPP]│  │             │
  │                              │  │ 지연: [Tabs]              │  │             │
  └──────────────────────────────┘  └──────────────────────────┘  └────────────┘
```
- 툴바 1행: Data Date(팝오버로 축소) · 구분선 · Task Filter · Discipline · 구분선 · 지연 필터 · (ml-auto) 검색
- 툴바 2행(모바일에서만 wrap): 담당자축 Pills 전체 폭 사용
- 데스크톱(lg 이상)에서는 모두 1행에 배치, 그 이하에서는 자연스럽게 2행으로 wrap
- Data Date의 "(최신)" 표시와 초기화 버튼은 팝오버 트리거 옆 작은 뱃지/아이콘 버튼으로 통합

## 형태 변경 (최소)
- Data Date: `Select` → 컴팩트 `Popover` 트리거 (버튼에 날짜 텍스트 + 최신 여부 뱃지, 아이콘 버튼으로 초기화). SM/DMR에서 쓰는 `DataDatePicker` 스타일과 일치.
- Task Filter / Discipline 토글: 현재 ToggleGroup 형태 그대로 유지, 위치만 KPI 카드 상단 → 통합 툴바로 이동.
- 지연 필터: 현재 Tabs 그대로 유지.
- 담당자축 Pills(`OwnerQuickFilterPills`): 그대로 유지, 툴바 하단 행으로 이동.

## 편집 파일
- `src/components/task-management/dashboard/TmDashboardPage.tsx`
  - Header 블록에서 Data Date 셀렉트/최신 버튼 제거
  - Toolbar Card 재구성: 1행(Data Date + Task Filter + Discipline + 지연 필터 + 검색), 2행(담당자축 Pills)
  - Card에 `sticky top-0 z-20 bg-background/95 backdrop-blur` 적용
  - items 카운트를 헤더 우측으로 이동 (props로 전달 or 상단에서 계산)
- `src/components/task-management/dashboard/TmKpiCards.tsx`
  - 최상단 컨트롤 행(Task Filter + Discipline + items 카운트) 제거. props로 계속 taskScope/disciplines 수신은 유지하되 렌더링만 상단으로 이관.
  - 파일 자체 로직/계산은 변경 없음.

## 비 변경 사항
- KPI 카드, StatusMixBar, 하위 차트/테이블 로직 및 계산식 일체 유지.
- 필터 상태 관리(search params, patch), 라우팅 연결 유지.
- 담당자축·Discipline·지연 필터 옵션 및 동작 방식 유지.

## 검증
- 데스크톱(≥1280px): 1+1행 툴바가 세로 공간을 이전 대비 약 40~50px 축소하는지 확인.
- 태블릿/모바일: wrap이 자연스럽게 동작하고 sticky 시 KPI가 밑으로 스크롤되는지 확인.
- 각 필터 클릭 → 라우팅 search 파라미터 갱신 및 KPI 카운트 변동 확인.
