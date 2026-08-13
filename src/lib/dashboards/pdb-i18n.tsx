import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Project Dashboard(PDB) 전용 표시 언어.
 * 표시 문구만 바꾼다 — 집계·필터·수치 로직에는 관여하지 않는다.
 */
export type PdbLang = "ko" | "en";

const STORAGE_KEY = "pdb.lang";

type Dict = Record<string, string>;

const KO: Dict = {
  dataDate: "기준일",
  refreshHint: "저장된 캐시를 비우고 최신 데이터를 다시 불러온다",
  restoring: "캐시 복원 중…",
  totalQty: "모수",
  noData: "데이터 없음",
  others: "그 외",
  unassigned: "(미지정)",

  progressStatus: "진도현황",
  plannedVsActual: "계획 vs 실적 현황",
  planned: "계획",
  actual: "실적",
  byWorkType: "업무타입별 실적",
  byMainArea: "주요지역별 현황",
  teamPerformance: "Team 진도",

  hintTmProgress:
    "진도현황 = Sub 과업 실적%(서버 정본 srv_actual_pct, 없으면 누적 실적) 단순 평균 · 건수 = 실적 환산 완료분 / 모집단",
  hintTmWorkType:
    "Work Type(row_type) 별 과업 수 상위 4개 + 그 외 합계 · Work Type = Others 는 집계에서 제외 · 진도율 = 해당 그룹 실적% 단순 평균",
  hintTmSection:
    "진도율 = 해당 Plot Sub 과업 실적%(서버 정본 srv_actual_pct, 없으면 누적 실적) 단순 평균 — TM KPI Analysis 와 동일",
  hintSmProgress:
    "진도현황 = as-of 기준 Closure actual_upto ÷ Closure 모수 — SM KPI Analysis 와 동일",
  hintSmRoom:
    "지역별현황 = Room Group 별 Issued 건수와 Closure 진도율(Closed ÷ Issued) · SM Dashboard Room Group 카드와 동일한 정본 집계 · LG Podium 은 통합",
  hintSmSection:
    "진도율 = 해당 Plot Closure 실적 누계 ÷ Closure 모수 — SM KPI Analysis 와 동일(서버 totals 정본)",
  hintAbdProgress: "진도현황 = as-of 기준 Approval actual_upto ÷ 문서 모수",
  hintAbdTeam: "Team 별 문서 수 상위 4개 + Others · 진도율 = 실적 누계 ÷ 문서 모수",
  hintAbdSection:
    "진도율 = 해당 Plot Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일(서버 totals 정본)",

  unitCount: "건수",
  unitCountSuffix: "건",
  cumPct: "누적 %",
  leftAxis: "왼쪽 축",
  rightAxis: "오른쪽 축",
  targetDay: "당일목표",
  targetWeek: "금주목표",
  targetMonth: "당월목표",
  targetPeriod: "기간목표",
  noActualStart: "실적 시작 기준일 없음",
  excludedSuffix: "건 제외",
  trimmedNote: "개 구간 계획 없음",
  trimmedPrefix: "· 이후",

  delayAll: "전체",
  delayDelayed: "지연",
  delayRisk: "악화",
};

const EN: Dict = {
  dataDate: "Data Date",
  refreshHint: "Clear cached data and reload the latest",
  restoring: "Restoring cached data…",
  totalQty: "Total Q'ty",
  noData: "No data",
  others: "Others",
  unassigned: "(Unassigned)",

  progressStatus: "Progress Status",
  plannedVsActual: "Planned vs Actual",
  planned: "Planned",
  actual: "Actual",
  byWorkType: "Progress by Work Type",
  byMainArea: "Progress by Main Area",
  teamPerformance: "Team Performance",

  hintTmProgress:
    "Progress = simple average of Sub-task actual % · Count = earned-value equivalent complete / total",
  hintTmWorkType:
    "Top 4 work types by task count plus Others · Work Type = Others is excluded · Progress = simple average of actual % in each group",
  hintTmSection:
    "Progress = simple average of Sub-task actual % for the plot — same basis as TM KPI Analysis",
  hintSmProgress:
    "Progress = cumulative Closure actual as of date ÷ Closure scope — same basis as SM KPI Analysis",
  hintSmRoom:
    "By area = Issued count per Room Group and Closure progress (Closed ÷ Issued) · LG Podium consolidated",
  hintSmSection:
    "Progress = cumulative Closure actual for the plot ÷ Closure scope — same basis as SM KPI Analysis",
  hintAbdProgress: "Progress = cumulative Approval actual as of date ÷ total drawings",
  hintAbdTeam:
    "Top 4 teams by drawing count plus Others · Progress = cumulative actual ÷ total drawings",
  hintAbdSection:
    "Progress = cumulative Approval actual for the plot ÷ total drawings — same basis as the ABD Progress matrix",

  unitCount: "Nos.",
  unitCountSuffix: "No.",
  cumPct: "Cumulative %",
  leftAxis: "left axis",
  rightAxis: "right axis",
  targetDay: "Daily Target",
  targetWeek: "Weekly Target",
  targetMonth: "Monthly Target",
  targetPeriod: "Period Target",
  noActualStart: "No actual start date",
  excludedSuffix: "items excluded",
  trimmedNote: "periods",
  trimmedPrefix: "· no plan for the last",

  delayAll: "All",
  delayDelayed: "Delayed",
  delayRisk: "At Risk",
};

const DICT: Record<PdbLang, Dict> = { ko: KO, en: EN };

export type PdbKey = keyof typeof KO;

export function pdbT(lang: PdbLang | undefined, key: PdbKey): string {
  const l: PdbLang = lang === "en" ? "en" : "ko";
  return DICT[l][key] ?? DICT.ko[key] ?? String(key);
}

/** 차트 막대 용어(해당 시간 단위의 계획/실적) — 언어별. */
export function pdbBucketTerm(bucket: string | undefined, lang: PdbLang | undefined): string {
  const key: PdbKey =
    bucket === "week"
      ? "targetWeek"
      : bucket === "month"
        ? "targetMonth"
        : bucket === "day"
          ? "targetDay"
          : "targetPeriod";
  return pdbT(lang, key);
}

interface Ctx {
  lang: PdbLang;
  setLang: (l: PdbLang) => void;
}

const PdbLangContext = createContext<Ctx>({ lang: "ko", setLang: () => {} });

export function PdbLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<PdbLang>("ko");
  // 저장값 복원은 마운트 후에만 — SSR/hydration 불일치를 만들지 않는다.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === "en" || v === "ko") setLangState(v);
    } catch {
      /* storage 접근 불가 시 기본값 유지 */
    }
  }, []);
  const setLang = useCallback((l: PdbLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* 저장 실패는 무시 */
    }
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <PdbLangContext.Provider value={value}>{children}</PdbLangContext.Provider>;
}

export function usePdbLang(): Ctx {
  return useContext(PdbLangContext);
}

/** 문구 함수만 필요할 때. */
export function usePdbT(): (key: PdbKey) => string {
  const { lang } = usePdbLang();
  return useCallback((key: PdbKey) => pdbT(lang, key), [lang]);
}
