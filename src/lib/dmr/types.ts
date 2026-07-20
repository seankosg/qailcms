export type DmrTeam = 'ARCH' | 'ELEC' | 'MECH';
export type DmrDiscipline = DmrTeam;
export type DmrPlot = 'C' | 'D' | 'TOTAL';
export type DmrMetric = 'plan' | 'actual';

export interface DmrParsedRow {
  system: string;
  contractor: string;
  is_direct?: boolean;
  values: {
    plan: { C: number; D: number; TOTAL: number };
    actual: { C: number; D: number; TOTAL: number };
  };
}

export interface DmrParsedSection {
  discipline: DmrTeam;
  report_date: string; // YYYY-MM-DD
  rows: DmrParsedRow[];
  warnings?: string[];
}

export interface DmrEntryRow {
  id: string;
  report_date: string;
  discipline: DmrTeam;
  system_name: string;
  contractor_name: string;
  plot: DmrPlot;
  plan_manpower: number;
  actual_manpower: number;
  diff_manpower: number;
}

export const DMR_TEAMS: DmrTeam[] = ['ARCH', 'ELEC', 'MECH'];
export const DMR_DISCIPLINES: DmrDiscipline[] = DMR_TEAMS;
export const DMR_PLOTS: DmrPlot[] = ['C', 'D', 'TOTAL'];
export const DMR_METRICS: DmrMetric[] = ['plan', 'actual'];

export const TEAM_LABEL: Record<DmrTeam, string> = {
  ARCH: 'Architecture',
  ELEC: 'Electrical',
  MECH: 'Mechanical',
};

export const DISCIPLINE_LABEL: Record<DmrDiscipline, string> = TEAM_LABEL;

export function normalizeDmrTeam(value: unknown): DmrTeam {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'ELECT' || normalized === 'ELECTRICAL' || normalized === '전기') return 'ELEC';
  if (normalized === 'ARCH' || normalized === 'MECH' || normalized === 'ELEC') return normalized;
  throw new Error(`잘못된 TEAM 값: ${String(value ?? '')}`);
}