# SM 대시보드 LG 블록 신설 (마이그레이션 없음)

## 0. 확정 규칙

- **LG 블록 대상 = `building = 'LG'` 인 행 단독.** 현재 DB 실측 **1,129건**.
- `building` 이 `Podium` / `Podium 1~4` / `Tower` / `BSM` / `NULL` 인 행은 **기존 로직 그대로 유지** (LG 대상 아님).
- **LG = Lower Ground Level 을 뜻하는 독립 블록이며 `level_name` 의 `Level LG` 와 무관.** LG 대상이 아닌 `Level LG` 행은 기존대로 Basement 블록에 남는다.
- **DB 데이터 변경(마이그레이션·UPDATE) 없음.** 순수 프런트엔드 표시 로직 변경.

## 1. 사전 전수조사 결과 (실측)

### `building = 'LG'` 행의 `room_group` 분포 (총 1,129건)
| plan_title | room_group | 건수 |
|---|---|---|
| Plot C Podium 1 | Podium 1 | 374 |
| Plot C Podium 2 | Podium 2 | 305 |
| Plot C Podium 3 | Podium 3 | 103 |
| Plot C Podium 4 | Podium 4 | 123 |
| Plot D Podium 1 | Podium 1 | 116 |
| Plot D Podium 2 | Podium 2 | 15 |
| Plot D Podium 3 | Podium 3 | 57 |
| Plot D Podium 4 | Podium 4 | 36 |

→ **Plot C = 905건 · Plot D = 224건**, 컬럼은 양쪽 모두 `Podium 1~4`. `Podium 5` 데이터는 `building='LG'` 범위에 없음(현재 미노출, 향후 데이터 유입 시 자동 표시되도록 동적 처리).

### 충돌 검사 결과
- `building='LG'` 1,129건은 **전부** `room_group` 이 `Podium 1~4`. 다른 building 값에는 `Podium N` room_group 이 **0건**.
- 역으로 `room_group IN ('Podium 1'..'Podium 4')` 인 행 1,129건도 **전부** `building='LG'`.
- → **1:1 대응. 신규 블록 키 `lg` 및 신규 컬럼 키 `Podium N` 모두 기존 데이터와 충돌 없음.**

### 기존 블록 영향
`building='LG'` 행은 현재 `classifyBuilding()` 에서 `Others` 로 분류되어 **Podium 블록의 "Others" 행**에 표시되고 있음. LG 블록으로 이동하면 Podium 블록에서 1,129건이 빠진다. **Plot Grand Total 은 불변.**

---

## 2단계 — 블록 분류 (`src/lib/defect-management/dashboard-shape.ts`)

- `BlockKind` / `BlockKey` 에 `"lg"` 추가
- `classifyBuilding()` 에 `/^LG$/i` → `{ kind: "lg", label: "LG" }` 추가
- `buildMatrix()` 라우팅에서 **`bld.kind === "lg"` 검사를 `lvl.kind === "basement"` 검사보다 먼저** 수행
  - LG 대상이 아닌 행의 basement / tower / podium / Others 경로는 **완전 동일 유지**
- LG 블록은 **단일 행** (building `LG`, level 표기 없음 — level 은 귀속과 무관)
- 블록 배열 순서: Tower → Podium → **LG** → Basement
- 블록 제목: `"LG (Lower Ground)"`

## 3단계 — 컬럼 축 일반화

- `LG_ROOM_GROUPS = ["Podium 1" … "Podium 5"]` 상수 추가, `RoomGroupCol` 타입에 포함(총 15종)
- `normalizeRoomGroup()`: `PODIUM 1`~`PODIUM 5` 입력을 `Podium N` 으로 정규화 (기존 10종 매핑 동작 불변)
- `MatrixBlock` 에 `columnKeys: RoomGroupCol[]` 필드 추가
  - `lg` 블록 → 해당 Plot 에서 **실제 값이 존재하는 Podium 컬럼만** (현재 Plot C/D 모두 1~4)
  - 그 외 블록 → 기존 `ROOM_GROUP_ORDER` 10종 (**표시 무변경**)

## 4단계 — 매트릭스 렌더링 (`DeSnagMatrixBlock.tsx`)

- 하드코딩된 `ROOM_GROUP_ORDER` 순회를 전부 `block.columnKeys` 로 교체
  - 3단 헤더(Room Group > Status > Team) · 컬럼 총계 행 · 데이터 행 · 행 소계
- 드릴다운은 기존 `roomGroup` 파라미터 그대로 (DB 에 실제 `Podium N` 값이 저장되어 있으므로 신규 파라미터 불필요)
- 개수 / % / 잔여 개수 / 잔여 % 토글, 병목 팀 강조(15%p) 등 기존 동작 **전부 유지**

## 5단계 — `LG Podium` 카드 신설

- `DeSnagDashboardPage` 의 `roomGroupEntries` 계산에 Podium 1~5 합산 가상 엔트리 추가
  - 라벨 **`LG Podium`**, 기존 10개 Room Group 카드 **뒤**에 배치
  - 드릴다운 `roomGroup = "Podium 1,Podium 2,Podium 3,Podium 4"` (존재하는 컬럼만 결합)
  - 스택 바 · 범례(Open · Re-Opened · Rectified · Closed) 구조는 기존 카드와 **100% 동일**
- `DeSnagRoomGroupCards`: `col` 타입을 `string` 으로 완화하고 `{ col, label, param }` 으로 분리
- `DeSnagRoomGroupFilterBar`: `LG Podium` 칩 1개 추가 (선택 시 Podium 1~N 전체 필터)

## 6단계 — 엑셀 내보내기 (`matrix-excel.ts`)

- 컬럼 생성 루프를 `block.columnKeys` 기반으로 교체 → LG 섹션이 Podium 1~N 헤더로 출력

## 7단계 — 서버 RPC

`defect_snag_dashboard_matrix_json` 은 `building` / `room_group` 을 그대로 GROUP BY 하므로 **수정 불필요**. 별도 RPC 신설도 불필요.

---

## 셀프 체크리스트
- [ ] DB 데이터 변경 0건 (UPDATE 미실행)
- [ ] LG 블록 = `building='LG'` 1,129건 (Plot C 905 · Plot D 224)
- [ ] LG 대상이 아닌 `Level LG` 행은 기존대로 Basement 유지
- [ ] Podium 블록의 "Others" 행에서 LG 1,129건 제거 확인
- [ ] 블록 순서 Tower → Podium → LG → Basement
- [ ] LG 컬럼 = 실제 데이터가 있는 Podium 1~4
- [ ] LG 셀 클릭 → Raw Data `roomGroup=Podium N` 건수 일치
- [ ] `LG Podium` 카드 Issued = LG 블록 blockTotal.issued
- [ ] Plot Grand Total 변경 전후 동일
- [ ] 기존 Tower / Podium / Basement 블록 UI · 배치 · 문구 무변경
- [ ] 엑셀 LG 섹션 정상 출력
- [ ] 빌드 및 타입체크 통과