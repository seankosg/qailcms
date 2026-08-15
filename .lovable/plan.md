# Demob Plan 탭 (Organization)

Organization 페이지에 `Organization Chart` 옆 세 번째 탭 **Demob Plan** 을 추가한다.
HDEC PIC 개인별로 각 모듈(TM · SM · ABD · SPL · WRT)의 **최종 업무 종결일**을 계산하고,
그중 가장 늦은 날짜를 그 사람의 **철수(Demob) 시점**으로 가로 캘린더 축 위에 표시한다.

## UI 제안

```text
┌ Demob Plan ───────────────────────────────────────────────────────────────┐
│ [기준일 2026-08-15] [오늘]   검색[      ]  팀:[All ▾]  모듈:[TM SM ABD SPL WRT] │
│ KPI: 대상 인원 42 · 3개월 내 철수 8 · 최종 철수일 2027-03-12               │
├──────────────┬─────────────────────────────────────────────────────────────┤
│ 이름 / 팀     │ Aug'26  Sep   Oct   Nov   Dec   Jan'27  Feb   Mar          │
├──────────────┼─────────────────────────────────────────────────────────────┤
│ ▸ ARCH (12)   │  ← 팀 헤더 행: 팀 전체 최종 철수일에 굵은 마름모(◆)         │
│   김OO        │   ▬▬▬TM▬▬▬▬▬▬▬▬▬▬●   ▬SM▬●        ◆ 2026-11-20            │
│   이OO        │   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬●   ◆ 2027-01-08            │
│ ▸ MECH (9)    │                                                            │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

- **좌측 고정 컬럼**: 팀 그룹 헤더(팀명 + 인원수) → 그 아래 사용자 이름 오름차순.
  팀도 `team_master.sort_order` → 이름 순. 스티키 컬럼은 100% 불투명 배경.
- **가로 축**: `MilestoneTimelineCard` 의 월 눈금 방식을 그대로 재사용(월 시작 tick,
  `dd-MMM-yy` 라벨, 오늘/기준일 세로선). 범위 = 전체 데이터 최소일 ~ 최대 철수일 + 여백.
- **행 본문**: 사람마다 한 줄. 모듈별로 시작~종결 구간을 얇은 색 막대(모듈 고유색)로 겹쳐
  그리고, 각 막대 끝에 종결 점(●) + 모듈 약칭 툴팁. 개인 최종 철수일에 마름모(◆)와
  우측 날짜 라벨(`dd-MMM-yyyy`).
- **색상**: 모듈별 기존 토큰 재사용(TM/SM/ABD/SPL/WRT). 기준일 이전에 이미 종결된 사람은
  행 전체를 muted 처리 + "철수 가능" 배지.
- **행 클릭**: 우측 Sheet 로 상세 — 모듈별 최종일, 그 날짜를 만든 마지막 항목
  (번호·제목·날짜 종류), 모듈 Raw Data 로 이동 링크.
- **Export**: 우상단 XLSX 내보내기(이름·팀·모듈별 최종일·철수일).
- **필터**: 팀 다중선택, 이름 검색, 모듈 토글(끄면 철수일 계산에서 제외).

## 계산 규칙 (확정된 답변 반영)

- 대상 모듈: **TM · SM · ABD · SPL · WRT**
- 종결일 = **전체 항목의 최종일**: 완료 항목은 실적완료일, 미완료 항목은 예상/계획 완료일.
  모듈별 우선순위:
  - TM `actual_finish` → `expected_finish` → `forecast_end` → `plan_end`
  - SM `actual_ho_date` → `planned_ho_date` → (없으면 closure 단계 최종일)
  - ABD `approval_date` → 라운드 DAR actual → 라운드 DAR plan 중 최댓값
  - SPL / WRT `*_stage_progress` 의 actual finish → plan finish 최댓값
- 사람 매칭 키: `hdec_pic_name`(SPL/WRT 는 `pic`) 을 `hdec_name_norm` 규칙으로 정규화해
  `hdec_pic_name_master` 와 조인. 마스터에 없는 이름은 "미등록" 그룹으로 별도 표시.
- 개인 철수일 = 모듈 최종일들의 **최댓값**. 버퍼 없음(종결일 = 철수일).
- 제외 행: `is_active=false` / `is_excluded=true` 는 집계 제외.

## 권한

- 탭 노출·조회 **System Admin 전용** (`me.isSystemAdmin`). 그 외 사용자에게는 탭 자체 미표시.

## 기술 구현

1. 마이그레이션: `public.org_demob_plan()` RPC 신설 — `returns jsonb`
   (`{ rows: [{ pic_name, team, per_module: {tm, sm, abd, spl, wrt}, first_date, demob_date }], generated_at }`).
   내부에서 5개 모듈 CTE 를 UNION 하여 정규화 이름 기준 집계. `security definer`,
   `has_role(auth.uid(),'system_administrator')` 아니면 `RAISE EXCEPTION`.
   grant: `execute to authenticated`.
2. `src/components/organization/DemobPlanTab.tsx` — 캘린더 축 + 행 렌더링.
   축 계산 유틸은 `MilestoneTimelineCard` 의 tick 로직을 `src/lib/organization/demob-axis.ts` 로 추출·공유.
3. `src/components/organization/DemobDetailSheet.tsx` — 행 상세.
4. `src/lib/organization/export-demob-plan.ts` — XLSX 내보내기.
5. `OrganizationPage.tsx` 에 탭 추가(System Admin 조건부).
