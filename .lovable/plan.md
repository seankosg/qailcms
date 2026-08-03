# SM 대시보드 열축(Room Group) 값 커버리지 점검 및 보정

## 실측 결과

`defect_items_raw` (is_active=true) 의 `room_group` 실제 값은 22종입니다. 현재 `normalizeRoomGroup()`
(`src/lib/defect-management/dashboard-shape.ts:103-112`) 규칙과 대조하면 아래처럼 갈립니다.

### 정상 매핑 (열로 구현됨)
| 원본 값 | 건수 | 열 |
|---|---|---|
| BOH | 61,444 | BOH |
| TENANT | 23,132 | TENANT |
| FOH | 13,678 | FOH |
| STAIRCASE | 2,890 | STAIRCASE |
| LIFT | 1,426 | LIFT |
| FACADE | 513 | FACADE |
| CARPARK | 452 | CARPARK |
| CORRIDOR | 387 | CORRIDOR |
| LANDSCAPE | 73 | LANDSCAPE |
| CARPARK RAMP | 75 | CARPARK RAMP |
| Podium 1~5 | 934 | LG 블록 전용 열 |
| (빈 값) | 31 | N/A |

### 전용 열이 없어 N/A로 흡수되는 값 — 총 13,022건
| 원본 값 | 건수 | 현재 결과 |
|---|---|---|
| CARPARK/ RAMP | 7,941 | N/A |
| STAIR-2 | 2,294 | N/A |
| STAIR-1 | 2,271 | N/A |
| Main Lobby | 306 | N/A |
| FOH (Main Lobby) | 215 | N/A |
| CARPARK./ RAMP | 1 | N/A |

즉 열축은 22종 중 16종만 제대로 구현되어 있고, **6종 13,022건이 "N/A" 열로 뭉쳐 있습니다.**
특히 `CARPARK/ RAMP`(7,941건)는 이미 존재하는 `CARPARK RAMP` 열과 같은 의미인데
슬래시 표기 차이 때문에 매칭되지 않고 있습니다.

## 조치안 (승인 후 시행)

`normalizeRoomGroup()` 만 수정하며, 열 정의(`ROOM_GROUP_ORDER`)는 아래 표에 따라 최소 변경합니다.

1. **CARPARK 램프 표기 통합** — `CARPARK/ RAMP`, `CARPARK./ RAMP` → 기존 `CARPARK RAMP` 열로 흡수.
   구분자(`/`, `.`, 공백) 정규화 후 비교. (7,942건 정상화)
2. **STAIR-1 / STAIR-2** → 기존 `STAIRCASE` 열로 흡수 (`^STAIR` 계열 통합, 4,565건).
   ※ 별도 열로 분리를 원하시면 그렇게 조정합니다.
3. **Main Lobby / FOH (Main Lobby)** → 기존 `FOH` 열로 흡수 (521건).
   ※ 별도 `MAIN LOBBY` 열 신설을 원하시면 그렇게 조정합니다.
4. 위 통합 후 `N/A` 열에는 빈 값 31건만 남습니다.

드릴다운은 `roomGroupSourceValues()` 가 정규화 함수를 그대로 재사용하므로,
통합된 원본 값들이 자동으로 필터 파라미터에 포함되어 카드 숫자와 Raw Data 건수가 일치합니다.
엑셀 내보내기도 동일 경로를 타므로 별도 수정 불필요합니다.

## 기술 사항
- 수정 파일: `src/lib/defect-management/dashboard-shape.ts` (정규화 함수 1곳)
- UI 열 구성/배치/문구 변경 없음 — 기존 열에 값이 정확히 담기게 하는 데이터 매핑 보정입니다.
- 검증: 보정 후 각 열 합계 = 활성 행 총계(119,363) 검산, 드릴다운 건수 대조.
