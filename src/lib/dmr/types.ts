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

/**
 * Sub Contractor 이름 정규화 규칙.
 * - "HDEC, Anel" / "HDEC,Anel" / "HDEC ,Anel" 등 → "HDEC_Anel"
 * - "HDEC" (단독) → "HDEC_Direct"
 * - 그 외에는 앞뒤 공백만 제거
 */
export function normalizeDmrContractor(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  // HDEC, X  형태
  const m = raw.match(/^HDEC\s*[,\/]\s*(.+)$/i);
  if (m) return `HDEC_${m[1].trim().replace(/\s+/g, '_')}`;
  if (/^HDEC$/i.test(raw)) return 'HDEC_Direct';
  return raw;
}

export function isDmrDirectContractor(name: string): boolean {
  return /^hdec(_|$)/i.test(name);
}