# PDB 언어 토글 (KOR / ENG)

Project Dashboard(`/project-summary`) 상단 Setting 버튼 오른쪽에 KOR·ENG 토글을 추가한다. 기본값은 KOR. ENG 선택 시 PDB 화면에 보이는 한국어 문구가 건설 실무 영문 용어로 바뀐다. 선택값은 브라우저에 저장되어 다음 방문에도 유지된다.

적용 범위는 PDB 페이지 안에서 보이는 문구에 한정한다. 사이드바, 다른 모듈 페이지, 데이터 값(팀명·Room Group 등 원본 값)은 그대로 둔다. 수치·집계·필터 로직은 일절 손대지 않는다(표시 문구 교체만).

## 번역 용어 제안 (건설 실무 기준)

### 헤더 · 공통
| 한국어 | English |
| --- | --- |
| 기준일 | Data Date |
| 저장된 캐시를 비우고 최신 데이터를 다시 불러온다 | Clear cached data and reload the latest |
| 캐시 복원 중… | Restoring cached data… |
| 모수 (모듈 헤더의 "모수 1,234") | Total Q'ty (예: `Total Q'ty 1,234`) |
| 데이터 없음 | No data |
| 그 외 / Others | Others |
| (미지정) | (Unassigned) |

### KPI 카드
| 한국어 | English |
| --- | --- |
| 진도현황 | Progress Status |
| 계획 vs 실적 현황 | Planned vs Actual |
| 계획 (막대 라벨) | Planned |
| 실적 (막대 라벨) | Actual |
| 업무타입별 실적 | Progress by Work Type |
| 주요지역별 현황 | Progress by Main Area |
| Team 진도 | Team Performance |

### 툴팁(hint) 문구
| 한국어 | English |
| --- | --- |
| 진도현황 = as-of 기준 Approval actual_upto ÷ 문서 모수 | Progress = cumulative Approval actual as of date ÷ total drawings |
| 진도현황 = as-of 기준 Closure actual_upto ÷ Closure 모수 — SM KPI Analysis 와 동일 | Progress = cumulative Closure actual as of date ÷ Closure scope — same basis as SM KPI Analysis |
| 진도현황 = Sub 과업 실적%(…) 단순 평균 · 건수 = 실적 환산 완료분 / 모집단 | Progress = simple average of Sub-task actual % · Count = earned-value equivalent complete / total |
| 진도율 = 해당 Plot Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일 | Progress = cumulative Approval actual for the plot ÷ total drawings — same basis as the ABD Progress matrix |
| 진도율 = 해당 Plot Closure 실적 누계 ÷ Closure 모수 — SM KPI Analysis 와 동일 | Progress = cumulative Closure actual for the plot ÷ Closure scope — same basis as SM KPI Analysis |
| 진도율 = 해당 Plot Sub 과업 실적% 단순 평균 — TM KPI Analysis 와 동일 | Progress = simple average of Sub-task actual % for the plot — same basis as TM KPI Analysis |
| Work Type 별 과업 수 상위 4개 + 그 외 합계 · 진도율 = 해당 그룹 실적% 단순 평균 | Top 4 work types by task count plus Others · Progress = simple average of actual % in each group |
| 지역별현황 = Room Group 별 Issued 건수와 Closure 진도율(Closed ÷ Issued) · LG Podium 은 통합 | By area = Issued count per Room Group and Closure progress (Closed ÷ Issued) · LG Podium consolidated |
| Team 별 문서 수 상위 4개 + Others · 진도율 = 실적 누계 ÷ 문서 모수 | Top 4 teams by drawing count plus Others · Progress = cumulative actual ÷ total drawings |

### S-Curve 차트 문구
| 한국어 | English |
| --- | --- |
| 당일목표 / 금주목표 / 당월목표 / 기간목표 | Daily Target / Weekly Target / Monthly Target / Period Target |
| 건수 (단위 토글) | Nos. |
| 건 (단위 접미사) | No. |
| 오른쪽 축 / 왼쪽 축 | right axis / left axis |
| 누적 % | Cumulative % |
| 실적 시작 기준일 없음 — N건 제외 | No actual start date — N items excluded |
| · 이후 N개 구간 계획 없음 | · no plan for the last N periods |

건설 용어 선택 근거: 진도현황은 **Progress Status**, 툴팁 본문의 진도율은 **Progress**, 계획·실적은 **Planned / Actual**, 모수는 물량 기준이므로 **Total Q'ty**, 건수 단위는 **Nos. / No.** 로 통일한다. Plot / Room Group / Work Type / Team / Approval / Closure / Issued 는 이미 영문 고유 용어라 그대로 둔다.

## 기술 노트

- `src/lib/dashboards/pdb-i18n.ts` 신설: `PdbLang = "ko" | "en"`, 문구 사전(위 표), `t(key)` 헬퍼, React context(`PdbLangProvider` / `usePdbLang`).
- 선택값은 `localStorage("pdb.lang")` 에 저장, 기본 `"ko"`.
- `ProjectSummaryPage.tsx`: Setting 버튼 오른쪽에 2분할 토글 버튼(KOR | ENG) 추가, 페이지 전체를 `PdbLangProvider` 로 감싼다.
- 문구 치환 대상 파일: `ProjectSummaryPage.tsx`, `ProjectModuleSection.tsx`, `PdbBreakdownCard.tsx`, `TmDashboardSection.tsx`, `SmDashboardSection.tsx`, `AbdDashboardSection.tsx`.
- 공용 컴포넌트(`AbdKpiRows.tsx`의 `AbdKpiCard`, `TmPlanVsActualCard`, `SnagKpiPlanVsActualCard`, `AbdPlanVsActualCard`, `bucket-terms.ts`)는 다른 페이지에서도 쓰이므로 **기본값 `"ko"` 인 선택적 `lang` prop** 만 추가한다. PDB 호출부에서만 `lang` 을 넘기고, 다른 페이지의 표시는 한 글자도 바뀌지 않는다.
- 필터 요약 배지의 라벨(Task / Team / Stage / Plan / As of)은 이미 영문이라 변경 없음. 값 중 TM Delay 옵션 라벨(전체·지연·악화)만 ENG 시 All / Delayed / At Risk 로 매핑한다.
- 레이아웃·간격·색·차트 축 설정은 변경하지 않는다. 영문이 길어 잘리는 카드 제목은 기존 truncate 규칙을 그대로 따른다.
