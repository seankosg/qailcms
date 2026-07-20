export type DmrDiscipline = 'ARCH' | 'ELECT' | 'MECH';
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
  discipline: DmrDiscipline;
  report_date: string; // YYYY-MM-DD
  rows: DmrParsedRow[];
  warnings?: string[];
}

export interface DmrEntryRow {
  id: string;
  report_date: string;
  discipline: DmrDiscipline;
  system_name: string;
  contractor_name: string;
  plot: DmrPlot;
  plan_manpower: number;
  actual_manpower: number;
  diff_manpower: number;
}

export const DMR_DISCIPLINES: DmrDiscipline[] = ['ARCH', 'ELECT', 'MECH'];
export const DMR_PLOTS: DmrPlot[] = ['C', 'D', 'TOTAL'];
export const DMR_METRICS: DmrMetric[] = ['plan', 'actual'];

export const DISCIPLINE_LABEL: Record<DmrDiscipline, string> = {
  ARCH: 'Architecture',
  ELECT: 'Electrical',
  MECH: 'Mechanical',
};