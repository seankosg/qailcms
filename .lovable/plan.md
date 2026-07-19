## 목표

TM Raw Data 테이블에서 두 가지 시각적 개선:
1. `actual_progress = 100`인 완료 task 행 전체를 회색으로 흐리게 표시
2. Stage progress의 Finish 아이콘에서 정상완료와 지연완료를 시각적으로 구분

## 변경 범위 (프론트엔드 전용)

### 1. `src/components/task-management/raw-data/TaskStageProgress.tsx`

**`StageState` 타입 확장**
- 기존: `"completed" | "wip" | "delay" | "plan" | "empty"`
- 추가: `"completed_late"` (지연완료)

**`classifyFinish` 로직 수정**
- `actual_finish`가 있을 때:
  - `plan_end`도 있고 `actual_finish > plan_end` → `"completed_late"`
  - 그 외 → `"completed"` (정상완료)
- 나머지(wip / delay / plan / empty) 분기는 기존 유지

**스타일/글리프 매핑 추가**
- `STATE_STYLES.completed_late`: `"bg-emerald-600 border-emerald-600 text-white"` (색은 동일한 초록)
- `STATE_GLYPH.completed_late`: `"✕"` (X자 표시로 지연완료 구분)
- `STATE_STYLES.completed` / `STATE_GLYPH.completed`: 도넛 형태로 변경 → `"◯"` 스타일 대신, `Pip` 렌더 시 `completed`는 배경을 투명 + 두꺼운 초록 링(`bg-transparent border-2 border-emerald-600 text-emerald-600`)으로 렌더하고 글리프는 공백으로 처리하여 도넛 링만 보이게 함
  - 사용자의 "타 스테이지와 같은 도넛형태의 초록색" 요청 반영. Start 단계 completed도 동일 도넛 표현으로 통일
- `STATE_LABEL.completed_late`: `"Completed (Late)"`
- 툴팁(title)에서 `plan_end` 대비 지연 일수 표시 추가 (예: `Finish: Completed (Late) · 25 Jan (plan 20 Jan, +5d)`)

**Legend 갱신**
- `TaskStageProgressLegend`에 "Completed (Late) ✕" 항목 추가

### 2. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`

가상화 행 렌더 블록(라인 ~1012-1030)에서 완료 판정:
- `const isDone = Number((row.original as Row).actual_progress) >= 100;`
- 행 컨테이너 `className`에 `isDone && "opacity-50 text-muted-foreground"` 추가
- Frozen 셀 배경(`bg-card`/`bg-muted`)도 `isDone`일 때 `bg-muted/60`으로 대체하여 회색 톤 유지 (Core 규칙에 따라 sticky 컬럼은 계속 100% 불투명 유지)

## 영향받지 않는 것

- 필터/정렬 로직 (`stageProgressFilterFn`), 컬럼 정의, DB 스키마, RPC, 서버 함수는 변경하지 않음
- SM/ABD 도메인은 미변경
- 완료 판정 기준(`actual_progress >= 100`)만 UI 표시용으로 사용, 데이터/집계 로직은 유지

## 확인 필요

"타 스테이지와 같은 도넛 형태"라는 표현을 **정상완료 = 속이 빈 초록 링(도넛), 지연완료 = 초록 X**로 해석했습니다. 만약 "다른 스테이지처럼 속이 꽉 찬 초록 원(현재 완료 표시 그대로)"을 의미하고 지연완료만 X로 바꾸길 원하시면 알려주세요 — 그 경우 `completed` 글리프는 현재 `●` 그대로 두고 `completed_late`만 `✕`로 추가합니다.
