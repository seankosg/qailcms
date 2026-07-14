## 목표
Task Raw Data의 Progress 컬럼을 3단계 pip으로 변경. Start ↔ **Progress** ↔ Finish. 가운데 pip은 `auto_judgment`(Alarm) 컬럼 값으로 상태 결정.

## Alarm → pip 색상 매핑
`AlarmBadge`의 색과 시각적으로 일치하도록 5색 상태를 별도로 정의:

| Alarm 값 | pip 상태 | 색상 |
|---|---|---|
| `완료` | done | emerald ● |
| `정상` | ok | sky ● |
| `주의` | caution | amber ◐ |
| `지연` | late | orange ⊘ |
| `위험` | risk | rose ⊘ (pulse) |
| (빈 값) | empty | 옅은 회색 ○ |

Start/Finish pip은 기존 4상태(completed/wip/delay/plan/empty) 그대로 유지.

## 변경 파일

### 1. `src/components/task-management/raw-data/TaskStageProgress.tsx`
- `AlarmState` 타입 및 스타일 맵 추가 (위 5색).
- `classifyAlarm(row): AlarmState` 함수: `row.auto_judgment` 문자열을 위 매핑으로 변환. 알 수 없거나 빈 값이면 `empty`.
- `Pip` 컴포넌트가 두 종류(StageState / AlarmState) 스타일 맵을 각각 받을 수 있도록 스타일 전달 방식 단순화 (직접 className을 계산해 전달).
- 렌더: Start pip → 연결선 → Alarm pip → 연결선 → Finish pip.
- Tooltip에 `Alarm: <원본값>` 라인 추가.

### 2. `TaskManagementRawDataPage.tsx`
- `stage_progress` 컬럼의 `size` 를 80 → 100(또는 그 이상)으로 늘려 3 pip 여백 확보.

### 3. `src/lib/task-management/columns.ts`
- `stage_progress` 컬럼 `width: 80 → 100`.

## 검증
- `bunx tsgo --noEmit`
- 미리보기에서 Task Raw Data 접근 → Task No 옆에 3개의 원형 아이콘이 좌→우 Start/Alarm/Finish 순서. `auto_judgment` 값별로 색이 달라지는지 확인 (완료=녹, 정상=하늘색, 주의=황, 지연=주황, 위험=적+pulse).
- Tooltip에 Data Date, Start/Alarm/Finish 세 줄이 각각 나오는지 확인.

## 변경 파일 요약
- `src/components/task-management/raw-data/TaskStageProgress.tsx`
- `src/lib/task-management/columns.ts`
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
