# Outstanding Work 대시보드 최상단 — 마일스톤 타임라인 이식

레퍼런스 프로젝트의 대시보드 최상단 마일스톤 다이어그램(`src/components/dashboard/MilestoneTimeline.tsx`, 1~192행)을 Outstanding Work 대시보드 최상단으로 이식합니다. 기존 섹션 카드 2장은 폐기합니다.

## 확인된 현재 상태

- Outstanding 대시보드 = `src/components/dashboards/OutstandingDashboardPage.tsx` (제목 + `SectionDashboardCard` 2장: Task Management / Snag List Management). 마일스톤 관련 UI 없음.
- QAIL 마일스톤 정본 = `tm_milestone_config(plot, kind, target_date)` + `tm_milestone_kinds(kind_code, label, sort_order, is_active, deleted_at)`.
- 실측 등록값: Plot C 6건(2026-09-30 COC ~ 2027-09-30 DLP3), Plot D 6건(2026-05-30 ~ 2027-03-31), Plot G 6건 + 기준일 미지정 2건(HO, DLP).
- `SectionDashboardCard` 컴포넌트 자체는 Close-Out 대시보드에서도 쓰므로 파일은 남기고, Outstanding 화면에서의 사용만 제거합니다.

## 레퍼런스 대비 차이 (원본 유지 / 변경)

| 항목 | 레퍼런스 (`MilestoneTimeline.tsx`) | QAIL 이식 |
|---|---|---|
| 데이터 | `milestones` 테이블 단일 리스트 (22행) | `tm_milestone_config` × `tm_milestone_kinds`, `target_date` 오름차순, 기준일 미지정·비활성 제외 |
| 표시 단위 | 타임라인 1줄 | **Plot C·D·G 3줄 세로 나열** (카드 1장 안, Plot 라벨 좌측) |
| 등간격 배치 `msPosition` (32~35행) | 그대로 | 그대로 |
| 경과선 보간 `elapsedPercent` (38~55행) | 그대로 | 그대로 (Plot별 개별 계산) |
| Today 마커 (105~124행) | 그대로 | 그대로 |
| D-Day 배지 (61~82행) | 마지막 마일스톤 기준 | 그대로, **Plot 줄마다 각각** 표시 |
| 노드 원형·아이콘·라벨·날짜·D-Day 텍스트 (140~183행) | 그대로 | 그대로 (라벨은 `tm_milestone_kinds.label`) |
| 상태 색상 (11~16행) | `status` 컬럼 | **날짜 기준 자동**: 기준일 경과 = completed(초록), 첫 도래 예정 1건 = in_progress(파랑), 이후 = upcoming(회색). delayed(빨강)는 미사용 |
| 첫/마지막 노드 정렬 보정 (137~148행) | 그대로 | 그대로 |
| 오류 카드 `QueryErrorCard` | 전용 컴포넌트 | 프로젝트에 없음 → 카드 내 오류 문구 + 다시 시도 버튼으로 동등 대체 |
| 로딩 | `Skeleton h-24` | 그대로 (`@/components/ui/skeleton` 존재) |
| 색 토큰 `text-success` / `warning` / `destructive` / `primary` | 사용 | 그대로 사용 (`src/styles.css` 106·104행에 정의 확인) |

## 작업 내용

1. 신규 `src/components/dashboards/MilestoneTimelineCard.tsx`
   - 마일스톤 조회는 서버 함수(`*.functions.ts`)를 통해 `tm_milestone_config` + `tm_milestone_kinds` 조인 결과를 Plot별로 묶어 반환. TanStack Query로 구독.
   - 렌더링·좌표 계산·클래스는 레퍼런스 원본을 그대로 따르고, Plot 3줄 반복만 추가.
   - 오늘 기준일은 앱 표준시(Asia/Qatar) 기준 일자 사용.
2. `src/components/dashboards/OutstandingDashboardPage.tsx`
   - `SectionDashboardCard` 2장 및 그 import 제거.
   - 제목 아래 최상단에 `<MilestoneTimelineCard />` 배치.
3. `SectionDashboardCard.tsx` 파일은 Close-Out 대시보드가 계속 사용하므로 삭제하지 않습니다.

## 검증

- Plot C·D·G 3줄이 각각 6개 노드로 그려지고, 노드 순서가 기준일 오름차순인지 실측 대조.
- 오늘(2026-08-06) 기준: Plot D의 COC(2026-05-30)는 완료 색, HO(2026-08-30)가 진행중 색으로 표시되는지 확인.
- 기준일 미지정(Plot G의 HO·DLP)이 노드로 나타나지 않는지 확인.