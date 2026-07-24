## 배경

My Work Space(MWS)의 3개 리스트박스(TM/SM/ABD)를 아래 요구사항을 **모두 통합**하여 개편합니다.

1. 오늘 탭 기본 선택 (현재 `"all"` 로 남아있어 미동작)
2. 오늘 탭 의미 재정의 — 계획 기준(오늘 Start 또는 오늘 Finish)
3. 리스트박스 좌측에 탭-인지 컨텍스트 컬럼 신설
4. SM 오늘 탭에 `planned_start_date` 포함 → 좌측 배지에 `Start` 종류 추가
5. 각 리스트박스에 Raw Data와 동일한 Columns 메뉴 이식(사용자별 설정 저장)

---

## A. 오늘 탭 계획 기준 재정의 (`useMyWorkspaceData.ts`)

| 모듈 | 오늘 판정 (완료/승인 항목 제외) | 좌측 배지 종류 |
|---|---|---|
| TM | `plan_start == today` 또는 `plan_end == today` | `Start` / `Finish` (둘 다면 `Start·Finish`) |
| SM | `planned_start_date == today` 또는 `planned_rectified_date == today` 또는 `planned_closure_date == today` | `Start` / `Rectify` / `Close` (해당 종류 모두) |
| ABD | 현재 스테이지의 현재 단계 plan(`abdCurrentPlanDate`) `== today` | `Draft` / `Sub` / `Resp` |

- 신규 헬퍼: `tmIsToday(r,t) / tmTodayKinds(r,t)`, `smIsToday / smTodayKinds`, `abdIsToday / abdTodayKind`.
- `SmMyRow` 에 `planned_start_date: string | null` 추가, SM SELECT에 컬럼 반영.
- 기존 `tmIsCreatedToday`, `smIsCreatedToday`, `abdIsCreatedToday` 삭제 및 관련 import 정리.
- `*IsUpcoming` 3종을 `d >= 1 && d <= 3` (D-0 제외)로 변경 — D-0은 오늘 탭이 커버.

## B. 좌측 컨텍스트 컬럼 "구분" 신설

- 각 섹션 `columns` 배열 맨 앞에 `{ key: "__ctx", label: "구분" }` 삽입, 폭 `84px`.
- 렌더는 페이지에서 `activeTab` 을 closure로 참조해 다음을 표시:

| 탭 | TM | SM | ABD |
|---|---|---|---|
| 오늘 | Start / Finish 배지 (`kind`에 따라) | Start / Rectify / Close 배지 | Draft / Sub / Resp 배지 |
| 지연 | `Cum. Diff%` 절댓값 (예: `-23%`, destructive) | `D+n` 경과일 | `D+n` |
| 임박 | `D-n` (`plan_end − today`) | `D-n` (`due − today`) | `D-n` (`plan − today`) |
| 전체 | `—` | `—` | `—` |

- 배지 스타일은 `Badge variant="outline"` + tone별 border/text 색상.

## C. 기본 탭 = `today`

`MyWorkSpacePage.tsx` 의 3개 `useState<RowListTab>("all")` → `"today"` 로 변경.

## D. Raw Data 스타일 Columns 메뉴 이식

### D-1. 신규 컴포넌트 `MwsColumnOrderMenu.tsx`

`src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx` 의 UI/UX를 원본 그대로 이식:
- Popover + `Columns3` 트리거 · 상단에 안내/Reset 링크
- `GripVertical` 드래그로 순서 변경
- 체크박스로 표시/숨김
- `pin/unpin` 으로 좌측 고정(Frozen)
- Frozen 섹션(고정)과 Columns 섹션(가변) 분리
- MWS에는 field_config가 없으므로 rename(Pencil), 관리자 서버반영 콜백 제외
- prop `labels: Record<string,string>` 로 라벨 해석, `defaultOrder/defaultVisibility` 로 Reset 지원

### D-2. 상태 저장 훅 `useMwsColumnPrefs(viewKey, defaults)`

- 내부에서 기존 `useUserViewPreference(viewKey)` 사용 (계정 단위 서버 저장 + 로컬 캐시 + debounce).
- state 스키마: `{ order: string[]; visibility: Record<string,boolean>; frozen: string[] }`.
- 서버 값 도착 시 defaults 와 병합(누락 키 보강, 삭제 키 필터).
- 반환: `{ order, visibility, frozen, setOrder, setVisibility, setFrozen, ready }`.
- viewKey: `"mws-tm"` / `"mws-sm"` / `"mws-abd"`.

### D-3. `ModuleRowList.tsx` 확장

- 새 props: `order`, `visibility`, `frozen`, `toolbarExtra?: ReactNode`.
- 렌더 순서: `frozen` → 순서에 있는 나머지 visible 키. 정의 배열에서 lookup 하여 그림.
- 프론즌 컬럼은 `sticky left-...` + **100% 불투명 배경** 적용 (mem 규칙 `sticky-columns-opaque` 준수, 두 겹 gradient 스택).
- 상단 우측 "N 건" 옆에 `toolbarExtra` 슬롯 렌더 (Menu 조립은 페이지 담당).

### D-4. `__ctx` 컬럼 특수 처리

- defaults 에서 `frozen: ["__ctx"]`, `visibility["__ctx"]: true` 로 초기화.
- Menu 에서 `__ctx` 는 체크박스 disabled, unpin 불가(고정 강제) — Frozen 목록에는 노출.

## E. 파일별 변경 요약

1. `src/hooks/useMyWorkspaceData.ts`
   - `SmMyRow` 에 `planned_start_date` 추가 + SELECT 반영
   - `tmIsToday/tmTodayKinds`, `smIsToday/smTodayKinds`, `abdIsToday/abdTodayKind` 추가
   - `*IsCreatedToday` 삭제, `*IsUpcoming` 을 `d >= 1 && d <= 3` 로 변경

2. `src/components/my-work-space/MwsColumnOrderMenu.tsx` (신규)
   - Raw Data Columns 메뉴 UI/기능 이식 (rename 제외)

3. `src/hooks/useMwsColumnPrefs.ts` (신규)
   - `useUserViewPreference` 기반 order/visibility/frozen 저장 훅

4. `src/components/my-work-space/ModuleRowList.tsx`
   - `order/visibility/frozen/toolbarExtra` prop 추가, 프론즌 sticky 불투명 렌더

5. `src/components/my-work-space/MyWorkSpacePage.tsx`
   - 기본 탭 3개 → `"today"`
   - 각 섹션 컬럼 배열 맨 앞에 `__ctx` 컬럼 삽입(activeTab 참조 렌더)
   - `today` stats 를 새 오늘 로직으로 재계산 후 `counts.today` 전달
   - `useMwsColumnPrefs` 3개 인스턴스 + `MwsColumnOrderMenu` 3개를 각 `<ModuleRowList>` 의 `toolbarExtra` 로 전달
   - 삭제된 헬퍼 import 정리

---

## F. 확인 (반대 없으면 아래 기본값으로 진행)

1. 오늘 판정에서 완료(TM `actual_progress=1`)/승인(ABD `latest_status='A'`)/종결(SM closed/verified)은 제외.
2. 지연 표시 지표: TM은 `Cum. Diff%` 절댓값, SM/ABD는 `D+n` 경과일.
3. 좌측 컬럼 헤더 문구 = `구분`. Columns 메뉴에서 `__ctx` 는 숨김/해제 불가.
4. Columns 설정 스코프 = 모듈별(`mws-tm/sm/abd`), 계정 단위 서버 저장(기존 훅).
