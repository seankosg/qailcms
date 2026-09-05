# SM 대시보드 매트릭스 — 「잔여+Date」 토글 신설

## 목표

De-Snagging Matrix에 **잔여 개수와 Each Date를 한 화면에 동시 표시**하는 토글 스위치 `잔여+Date`를 추가한다. 기존 `HO Date` / `Each Date` 스위치와 상호 배타.

## 현재 상태 (실측)

- `DeSnagDashboardPage.tsx:119-141` — `eachDate` 스위치: 켜지면 `useSnagStageDates` 조회 후 `stageDates` 맵을 `DeSnagMatrixBlock`에 전달, 셀 숫자를 날짜(dd/mmm)로 **대체** (`DeSnagMatrixBlock.tsx:157-165`)
- `DeSnagMatrixBlock.tsx:36` — 그룹(Room Group)당 열 수 `COLS_PER_GROUP = 6 slots × 3 teams = 18` (Issued + Rect/Pre/DAR/Closed/HO)
- 헤더 3단(Room Group → Status → Team), sticky top 오프셋 0/30/54, Column Total 행 top 78
- URL 파라미터 `eachDate`/`hoDate` (0/1, 상호 배타) — `src/routes/_authenticated/closure/snag-management/dashboard.tsx`

## 구현 내용

### 1. URL 파라미터 · 토글 상호 배타

- `dashboard.tsx` searchSchema에 `remainDate: 0|1` (기본 0) 추가
- `DeSnagDashboardPage.tsx`에 세 번째 Switch `잔여+Date` 추가 (기존 두 스위치 옆)
- 상호 배타 규칙: `remainDate` ON → `hoDate=0, eachDate=0`. 반대도 동일
- `useSnagStageDates` 활성 조건을 `eachDate || remainDate`로 확장

### 2. 매트릭스 열 구조 (remainDate 모드)

그룹(Room Group)당 열 배치 — **Stage 순서대로, 각 Stage 안에서 부서별 잔여 개수 → 부서별 Each Date**:

```text
| Issued            | Rect                        | Pre-Ins                     | … (DAR/Closed/HO 동일)
| Elec|Mech|Arch    | Elec|Mech|Arch| E  | M  | A | Elec|Mech|Arch| E  | M  | A |
| (잔여 아님, 개수)  | ← 잔여 개수 →  | ← Date → | ← 잔여 개수 →  | ← Date → |
```

- Issued 슬롯: 날짜 없음 → 잔여 개수 3열만 유지 (Each Date 모드의 `–` 규칙과 동일 취지)
- Stage 슬롯 5개 × (잔여 3열 + Date 3열) = 30열 + Issued 3열 = **그룹당 33열** (기존 18열)
- Date 열 헤더(Tier 3)는 팀명을 연하게/축약 표기해 잔여 열과 시각 구분, Date 그룹 시작에 좌측 구분선 추가

### 3. 헤더 4단화

- Tier 2(Stage) 아래에 **「잔여 / Date」 서브 티어** 추가 (remainDate 모드에서만): Stage colSpan 6 → 잔여 3 + Date 3
- sticky top 오프셋 재계산 (0/30/54/78 → 4단 높이), Column Total 행 sticky top 도 함께 조정
- 헤더·sticky 배경은 기존 `color-mix` 불투명 패턴 유지 (메모리 규칙 준수)

### 4. 셀 렌더링 (`TeamCells` 확장)

- `remainDate` 모드에서는 `matrixMode`와 무관하게 **잔여 개수로 고정** (`issued - done`, 0 미만 방지 기존 로직 재사용)
- 모드 탭(개수/%/잔여 개수/잔여 %)은 remainDate ON 동안 **비활성(disabled)** 처리 — 혼동 방지
- Date 셀 규칙은 Each Date 모드와 동일: 해당 Stage 잔여 0(완료) → **실적일** + 회색 반전, 그 외 → **계획일**, 값 없음 → `–`
- 병목 강조(`bg-destructive/15`)·Ready for Inspection/Handover 색상은 **잔여 개수 셀에만** 적용, Date 셀은 기존 Each Date 색 규칙만
- 드릴다운: 잔여 셀·Date 셀 모두 기존 `goCell(slot, team)`과 동일 파라미터(`dateField` + as-of 상한)로 Raw Data 이동
- 툴팁: Date 셀은 `TEAM Stage: 잔여 N · 계획일/실적일 dd/mmm` 형태

### 5. 엑셀 내보내기 반영

`src/lib/defect-management/matrix-excel.ts`(`exportSnagMatrixToXlsx`)에 `remainDate` · `stageDates` 인자를 추가해 **화면과 동일한 열 구조**로 내보낸다.

- 그룹당 열 수(`PER_GROUP`)를 remainDate 모드에서 33열로 확장: Issued 3 + Stage 5 × (잔여 3 + Date 3)
- 헤더 3단 → 4단(Room Group / Stage / 잔여·Date / 팀) 병합 셀 생성
- 값 규칙은 화면과 동일: 잔여는 숫자, Date는 `dd/mmm` 문자열(완료 시 실적일, 그 외 계획일, 없으면 `–`)
- 열 너비: Date 열 9, 잔여 열 7
- 파일명 태그 `REMAIN-DATE` → `CMS_SM_Dashboard_Matrix_PLOT-C_REMAIN-DATE_{asOf}.xlsx`
- 기존 count/pct/remain/remainPct 및 HO Date 내보내기 동작은 그대로 유지

### 6. 범위 외 (변경하지 않음)


- `HO Date` / `Each Date` 기존 동작, RPC(`defect_snag_stage_dates_json`), `stage-dates.ts` 조립 로직 그대로 재사용
- Grand Total 카드·Room Group 카드·필터바 변경 없음

## 수정 파일

| 파일 | 변경 |
|---|---|
| `src/routes/_authenticated/closure/snag-management/dashboard.tsx` | `remainDate` 파라미터 추가 |
| `src/components/defect-management/dashboard/DeSnagDashboardPage.tsx` | 스위치 추가, 상호 배타, stageDates 조회 확장, 모드 탭 비활성 |
| `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx` | 33열 레이아웃, 헤더 4단화, TeamCells 날짜 서브열, sticky 오프셋 |

## 검증

- 타입체크 통과
- 프리뷰에서 토글 ON/OFF, 상호 배타, Plot/팀/Room Group 필터 조합, 드릴다운 숫자 정합(잔여 셀 = Raw Data 건수) 확인
- 스크린샷으로 33열 레이아웃·헤더 정렬·sticky 동작 확인
