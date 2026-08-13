/**
 * DMR 생산성 — 계산 정본 (한 벌).
 *
 * DmrProductivityPage 와 DmrDashboardPage 의 생산성 카드가 이 모듈만 쓴다.
 * 화면에서 다시 계산하지 않는다.
 *
 * 용어: 당일계획 · 당일실적 (기간을 잡으면 그 기간의 계획/실적 증가분을 뜻한다).
 * 분자는 TM 정본, 분모는 dmr_entries 의 actual_manpower 합.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PeriodKind = 'day' | 'week' | 'month' | 'range' | 'all';

export interface Period {
  kind: PeriodKind;
  /** 실제 적용된 시작일 (누계 전체는 이력 개시일) */
  start: string;
  end: string;
}

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  day: '일',
  week: '주',
  month: '월',
  range: '기간',
  all: '누계 전체',
};

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 기간 산출. 누계 전체는 이력 개시일부터 자른다(없으면 기준일 하루). */
export function resolvePeriod(
  kind: PeriodKind,
  base: string,
  opts: { from?: string; to?: string; historyStart?: string | null } = {},
): Period {
  if (kind === 'day') return { kind, start: base, end: base };
  if (kind === 'week') return { kind, start: addDays(base, -6), end: base };
  if (kind === 'month') return { kind, start: `${base.slice(0, 7)}-01`, end: base };
  if (kind === 'range') {
    const start = opts.from || base;
    const end = opts.to || base;
    return { kind, start: start <= end ? start : end, end: start <= end ? end : start };
  }
  return { kind: 'all', start: opts.historyStart || base, end: base };
}

/** derived.ts normActual 과 동일 — n>1 이면 /100, [0,1] 로 자른다. */
export function normActual(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  const x = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, x));
}

export interface DmrManpowerRow {
  report_date: string;
  task_no: string | null;
  actual_manpower: number | null;
  headcount_kind: string | null;
  discipline: string | null;
  system_name: string | null;
  plot: string | null;
  contractor_name: string | null;
}

export interface ProductivityInput {
  period: Period;
  /** 기간의 dmr_entries 행 */
  dmrRows: DmrManpowerRow[];
  /** 끝 시점 TM 정본 행 (메타 + cum_plan_pct) */
  tmEnd: Array<Record<string, any>>;
  /** 시작일−1 시점 코드별 누계 계획% (누계 전체는 비운다 = 0 기준) */
  planPrevByCode: Map<string, number>;
  /** 끝 시점 코드별 누계 실적% (정규화 완료) */
  actualEndByCode: Map<string, number>;
  /** 시작일−1 시점 코드별 누계 실적% (누계 전체는 비운다 = 0 기준) */
  actualPrevByCode: Map<string, number>;
  /** 누계 전체 여부 — 시작 기준을 0 으로 둔다 */
  fromZero: boolean;
}

export interface ContractorShare {
  name: string;
  manpower: number;
}

export interface ProductivityRow {
  task_no: string;
  task_name: string;
  work_type: string;
  team: string;
  plot: string;
  contractors: ContractorShare[];
  systems: string[];
  /** DMR 상 그 코드에 붙은 공종 (둘 이상이면 두 공종에 걸쳐 들어온 코드) */
  dmr_teams: string[];
  /** 당일계획% (기간 증가분, 0..1) */
  plan_pct: number | null;
  /** 당일실적% (기간 증가분, 0..1 · 음수 가능) */
  actual_pct: number | null;
  manpower: number;
  /** 그 코드에 인원 기록이 있는 날 수 */
  record_days: number;
  /** 당일실적% ÷ 인원 */
  productivity: number | null;
  /** 당일계획% ÷ 인원 */
  plan_productivity: number | null;
  /** 당일실적% ÷ 당일계획% */
  achievement: number | null;
  /** 추가 필요 인원·일 = 부족분 ÷ 계획 생산성 */
  extra_manpower: number | null;
  /** 하루 추가 인원 = 추가 인원·일 ÷ 기록일 수 */
  extra_manpower_per_day: number | null;
  /** Data Date 격차(일) — 0 이 아니면 주의 */
  data_date_gap: number | null;
  note: string;
  kind: '가' | '나' | '다';
}

export interface ProductivitySummary {
  codes: number;
  manpower: number;
  planSum: number;
  actualSum: number;
  productivity: number | null;
  planProductivity: number | null;
  achievement: number | null;
  extraManpower: number;
  /** 기록일 비율 중앙값 */
  recordRatioMedian: number | null;
  /** 인원 없이 실적만 오른 코드 수 */
  actualWithoutManpower: number;
  /** Data Date 격차가 0 이 아닌 코드 수 */
  dataDateGapCodes: number;
  calendarDays: number;
}

/** 코드별 한 벌 계산. 화면은 이 결과만 읽는다. */
export function buildProductivity(input: ProductivityInput): ProductivityRow[] {
  const { dmrRows, tmEnd, period, fromZero } = input;

  const mp = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  const systems = new Map<string, Set<string>>();
  const contractors = new Map<string, Map<string, number>>();
  const dTeams = new Map<string, Set<string>>();
  const dPlots = new Map<string, Set<string>>();

  for (const r of dmrRows) {
    const code = (r.task_no ?? '').trim();
    if (!code) continue;
    const n = Number(r.actual_manpower ?? 0) || 0;
    // headcount_kind 는 전 종류를 더한다(현재는 worker 뿐).
    mp.set(code, (mp.get(code) ?? 0) + n);
    if (n > 0) {
      if (!days.has(code)) days.set(code, new Set());
      days.get(code)!.add(r.report_date);
    }
    if (r.system_name) {
      if (!systems.has(code)) systems.set(code, new Set());
      systems.get(code)!.add(r.system_name);
    }
    if (r.contractor_name) {
      if (!contractors.has(code)) contractors.set(code, new Map());
      const m = contractors.get(code)!;
      m.set(r.contractor_name, (m.get(r.contractor_name) ?? 0) + n);
    }
    if (r.discipline) {
      if (!dTeams.has(code)) dTeams.set(code, new Set());
      dTeams.get(code)!.add(r.discipline);
    }
    if (r.plot) {
      if (!dPlots.has(code)) dPlots.set(code, new Set());
      dPlots.get(code)!.add(r.plot);
    }
  }

  const out: ProductivityRow[] = [];
  const seen = new Set<string>();

  for (const t of tmEnd) {
    const code = String(t.task_no ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const manpower = mp.get(code) ?? 0;

    const aEnd = input.actualEndByCode.get(code) ?? 0;
    const aPrev = fromZero ? 0 : (input.actualPrevByCode.get(code) ?? 0);
    const actual_pct = aEnd - aPrev;

    const pEndRaw = t.cum_plan_pct;
    const pEnd = pEndRaw == null ? null : Number(pEndRaw);
    const pPrev = fromZero ? 0 : input.planPrevByCode.get(code);
    const plan_pct = pEnd == null || pPrev == null ? null : pEnd - pPrev;

    const hasActual = actual_pct !== 0;
    if (manpower <= 0 && !hasActual) continue;

    const record_days = days.get(code)?.size ?? 0;
    const productivity = manpower > 0 ? actual_pct / manpower : null;
    const plan_productivity =
      manpower > 0 && plan_pct != null && plan_pct > 0 ? plan_pct / manpower : null;
    const achievement = plan_pct != null && plan_pct > 0 ? actual_pct / plan_pct : null;

    // 추가 필요 인원 — 분모는 계획 생산성이다(실측 생산성으로 나누지 않는다).
    let extra: number | null = null;
    if (plan_pct != null && plan_pct > 0 && plan_productivity != null && achievement != null) {
      extra = achievement >= 1 ? 0 : (plan_pct - actual_pct) / plan_productivity;
    }
    const extraPerDay = extra != null && record_days > 0 ? extra / record_days : null;

    const dd = t.data_date ? String(t.data_date).slice(0, 10) : null;
    const gap = dd ? diffDays(dd, period.end) : null;

    const notes: string[] = [];
    let kind: ProductivityRow['kind'] = '가';
    if (manpower <= 0) {
      kind = '다';
      notes.push('인원 기록 없이 진도 상승');
    } else if (!hasActual) {
      kind = '나';
    }
    if (gap != null && gap !== 0) notes.push(`Data Date 격차 ${gap}일 (${dd})`);

    out.push({
      task_no: code,
      task_name: String(t.task_name ?? ''),
      work_type: String(t.row_type ?? ''),
      team: String(t.discipline ?? t.team ?? ''),
      plot: String(t.plot ?? ''),
      contractors: Array.from(contractors.get(code) ?? [])
        .map(([name, m]) => ({ name, manpower: m }))
        .sort((a, b) => b.manpower - a.manpower || a.name.localeCompare(b.name)),
      systems: Array.from(systems.get(code) ?? []).sort(),
      dmr_teams: Array.from(dTeams.get(code) ?? []).sort(),
      plan_pct,
      actual_pct,
      manpower,
      record_days,
      productivity,
      plan_productivity,
      achievement,
      extra_manpower: extra,
      extra_manpower_per_day: extraPerDay,
      data_date_gap: gap,
      note: notes.join(' · '),
      kind,
    });
  }

  return out;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 합계는 합 ÷ 합이다 — 행별 생산성의 평균이 아니다. */
export function summarize(rows: ProductivityRow[], period: Period): ProductivitySummary {
  const calendarDays = Math.max(1, diffDays(period.start, period.end) + 1);
  let manpower = 0;
  let planSum = 0;
  let actualSum = 0;
  let extra = 0;
  const ratios: number[] = [];
  let noMp = 0;
  let gapCodes = 0;
  for (const r of rows) {
    manpower += r.manpower;
    if (r.plan_pct != null) planSum += r.plan_pct;
    if (r.actual_pct != null) actualSum += r.actual_pct;
    if (r.extra_manpower != null) extra += r.extra_manpower;
    if (r.manpower > 0) ratios.push(Math.min(1, r.record_days / calendarDays));
    if (r.kind === '다') noMp += 1;
    if (r.data_date_gap != null && r.data_date_gap !== 0) gapCodes += 1;
  }
  const productivity = manpower > 0 ? actualSum / manpower : null;
  const planProductivity = manpower > 0 && planSum > 0 ? planSum / manpower : null;
  return {
    codes: rows.length,
    manpower,
    planSum,
    actualSum,
    productivity,
    planProductivity,
    achievement: planSum > 0 ? actualSum / planSum : null,
    extraManpower: extra,
    recordRatioMedian: median(ratios),
    actualWithoutManpower: noMp,
    dataDateGapCodes: gapCodes,
    calendarDays,
  };
}

/* ────────────────────────── 팀 · 업체 집계 ────────────────────────── */

export interface TeamAgg {
  team: string;
  codes: number;
  manpower: number;
  planSum: number;
  actualSum: number;
  productivity: number | null;
  achievement: number | null;
  extraManpower: number;
  /** 두 공종에 걸쳐 들어온 코드 (실측 확인용) */
  crossTeamCodes: string[];
}

export function aggregateByTeam(rows: ProductivityRow[]): TeamAgg[] {
  const m = new Map<string, TeamAgg>();
  for (const r of rows) {
    const key = r.team || '(미지정)';
    let a = m.get(key);
    if (!a) {
      a = {
        team: key, codes: 0, manpower: 0, planSum: 0, actualSum: 0,
        productivity: null, achievement: null, extraManpower: 0, crossTeamCodes: [],
      };
      m.set(key, a);
    }
    a.codes += 1;
    if (r.dmr_teams.length > 1) a.crossTeamCodes.push(r.task_no);
    a.manpower += r.manpower;
    if (r.plan_pct != null) a.planSum += r.plan_pct;
    if (r.actual_pct != null) a.actualSum += r.actual_pct;
    if (r.extra_manpower != null) a.extraManpower += r.extra_manpower;
  }
  for (const a of m.values()) {
    a.productivity = a.manpower > 0 ? a.actualSum / a.manpower : null;
    a.achievement = a.planSum > 0 ? a.actualSum / a.planSum : null;
  }
  return Array.from(m.values()).sort((x, y) => (y.productivity ?? -Infinity) - (x.productivity ?? -Infinity));
}

export interface ContractorRow {
  contractor: string;
  task_no: string;
  task_name: string;
  /** 그 업체의 인원 (안분하지 않는다) */
  manpower: number;
  /** 그 코드 전체 인원 */
  codeManpower: number;
  actual_pct: number | null;
  /** 단독 코드면 업체 인원 기준, 공동 코드면 코드 전체 인원 기준 */
  productivity: number | null;
  shared: boolean;
  sharedCount: number;
}

export function aggregateByContractor(rows: ProductivityRow[]): {
  rows: ContractorRow[];
  soloCodes: number;
  sharedCodes: number;
} {
  const out: ContractorRow[] = [];
  let solo = 0;
  let shared = 0;
  for (const r of rows) {
    if (r.contractors.length === 0) continue;
    const isShared = r.contractors.length > 1;
    if (isShared) shared += 1;
    else solo += 1;
    for (const c of r.contractors) {
      const denom = isShared ? r.manpower : c.manpower;
      out.push({
        contractor: c.name,
        task_no: r.task_no,
        task_name: r.task_name,
        manpower: c.manpower,
        codeManpower: r.manpower,
        actual_pct: r.actual_pct,
        productivity: denom > 0 && r.actual_pct != null ? r.actual_pct / denom : null,
        shared: isShared,
        sharedCount: r.contractors.length,
      });
    }
  }
  out.sort((a, b) => (b.productivity ?? -Infinity) - (a.productivity ?? -Infinity));
  return { rows: out, soloCodes: solo, sharedCodes: shared };
}

/** 업체 소계 — 공동 코드의 실적은 넣지 않는다(이중 계상 방지). */
export interface ContractorSubtotal {
  contractor: string;
  soloManpower: number;
  sharedManpower: number;
  actualSum: number;
  productivity: number | null;
}

export function contractorSubtotals(rows: ContractorRow[]): ContractorSubtotal[] {
  const m = new Map<string, ContractorSubtotal>();
  for (const r of rows) {
    let a = m.get(r.contractor);
    if (!a) {
      a = { contractor: r.contractor, soloManpower: 0, sharedManpower: 0, actualSum: 0, productivity: null };
      m.set(r.contractor, a);
    }
    if (r.shared) a.sharedManpower += r.manpower;
    else {
      a.soloManpower += r.manpower;
      if (r.actual_pct != null) a.actualSum += r.actual_pct;
    }
  }
  for (const a of m.values()) {
    a.productivity = a.soloManpower > 0 ? a.actualSum / a.soloManpower : null;
  }
  return Array.from(m.values()).sort((x, y) => (y.soloManpower + y.sharedManpower) - (x.soloManpower + x.sharedManpower));
}

/* ────────────────────────── 데이터 조회 ────────────────────────── */

async function fetchDmrRange(start: string, end: string): Promise<DmrManpowerRow[]> {
  const out: DmrManpowerRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase
      .from('dmr_entries')
      .select('report_date, task_no, actual_manpower, headcount_kind, discipline, system_name, plot, contractor_name')
      .gte('report_date', start)
      .lte('report_date', end)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as DmrManpowerRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchTmRows(asOf: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await (supabase as any).rpc('tm_rows_as_of_json', { p_as_of: asOf });
  if (error) throw new Error(error.message);
  if (data != null && !Array.isArray(data)) {
    throw new Error('tm_rows_as_of_json RPC contract mismatch: expected jsonb array');
  }
  return (data ?? []) as Array<Record<string, any>>;
}

/** as-of 누계 실적(정규화) — id 기준. tm_actual_at_set 한 번. */
async function fetchActualSet(asOf: string): Promise<Array<Record<string, any>>> {
  const { data, error } = await (supabase as any).rpc('tm_actual_at_set', { _as_of: asOf });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, any>>;
}

/** 진도 이력 개시일 (누계 전체의 시작점). */
export function useTmHistoryStart() {
  return useQuery({
    queryKey: ['tm-history-start'],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('task_management_status_history')
        .select('changed_at')
        .eq('field', 'actual_progress')
        .order('changed_at', { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      const v = (data ?? [])[0]?.changed_at as string | undefined;
      if (!v) return null;
      // Asia/Qatar(+3) 기준 날짜
      return new Date(Date.parse(v) + 3 * 3_600_000).toISOString().slice(0, 10);
    },
  });
}

/**
 * 기간 생산성 — RPC 는 최대 4번(끝/시작−1 두 시점)만 부른다.
 * 하루치를 더해 기간을 만들지 않는다.
 */
export function useProductivity(period: Period, enabled = true) {
  const fromZero = period.kind === 'all';
  const prevDay = addDays(period.start, -1);

  return useQuery({
    queryKey: ['dmr-productivity', period.kind, period.start, period.end],
    enabled: enabled && !!period.start && !!period.end,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ rows: ProductivityRow[]; dmrRows: DmrManpowerRow[] }> => {
      const [dmrRows, tmEnd, actEnd, tmPrev, actPrev] = await Promise.all([
        fetchDmrRange(period.start, period.end),
        fetchTmRows(period.end),
        fetchActualSet(period.end),
        fromZero ? Promise.resolve([]) : fetchTmRows(prevDay),
        fromZero ? Promise.resolve([]) : fetchActualSet(period.start),
      ]);

      const idToCode = new Map<string, string>();
      for (const t of tmEnd) idToCode.set(String(t.id), String(t.task_no ?? '').trim());

      const actualEndByCode = new Map<string, number>();
      for (const a of actEnd) {
        const code = idToCode.get(String(a.task_raw_id));
        if (!code) continue;
        actualEndByCode.set(code, normActual(a.b_asof ?? a.a_asof ?? 0));
      }
      const actualPrevByCode = new Map<string, number>();
      for (const a of actPrev) {
        const code = idToCode.get(String(a.task_raw_id));
        if (!code) continue;
        // tm_actual_at_set(start) 의 prev = start−1 시점 누계
        actualPrevByCode.set(code, normActual(a.b_prev ?? a.a_prev ?? 0));
      }
      const planPrevByCode = new Map<string, number>();
      for (const t of tmPrev) {
        const code = String(t.task_no ?? '').trim();
        if (!code || t.cum_plan_pct == null) continue;
        if (!planPrevByCode.has(code)) planPrevByCode.set(code, Number(t.cum_plan_pct));
      }

      const rows = buildProductivity({
        period, dmrRows, tmEnd, planPrevByCode, actualEndByCode, actualPrevByCode, fromZero,
      });
      return { rows, dmrRows };
    },
  });
}

export const fmtPct = (v: number | null | undefined, digits = 2) =>
  v == null ? '' : `${(v * 100).toFixed(digits)}%`;
export const fmtProd = (v: number | null | undefined) =>
  v == null ? '' : `${(v * 100).toFixed(3)}%/인`;
export const fmtExtra = (v: number | null | undefined, unit = '명/일') =>
  v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${unit}`;
