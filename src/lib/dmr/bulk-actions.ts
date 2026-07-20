import { buildStyledWorkbook, saveStyledWorkbook, type ColumnKind } from '@/lib/excel/styled-workbook';

export interface ExportColumn {
  key: string;
  label: string;
  kind?: ColumnKind;
  widthPx?: number;
}

export const DMR_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'report_date', label: 'Date', kind: 'date', widthPx: 100 },
  { key: 'discipline', label: 'TEAM', kind: 'text', widthPx: 70 },
  { key: 'system_name', label: 'Work Description', kind: 'text', widthPx: 220 },
  { key: 'contractor_name', label: 'Sub Contractor', kind: 'text', widthPx: 220 },
  { key: 'plot', label: 'Plot', kind: 'text', widthPx: 60 },
  { key: 'plan_manpower', label: 'Plan', kind: 'number', widthPx: 100 },
  { key: 'actual_manpower', label: 'Actual', kind: 'number', widthPx: 100 },
  { key: 'diff_manpower', label: 'Diff (Actual−Plan)', kind: 'number', widthPx: 130 },
];

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function exportDmrToXlsx(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
  fileName: string;
}) {
  const wb = buildStyledWorkbook({
    title: 'DMR — Raw Data (Selected Rows)',
    columns: args.columns.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind ?? 'text',
      widthPx: c.widthPx,
    })),
    rows: args.rows,
    sheetName: 'Selected',
    freezeCols: 1,
  });
  saveStyledWorkbook(wb, args.fileName);
}

export async function copyDmrAsTsv(args: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}): Promise<{ rowCount: number; colCount: number }> {
  const lines = [args.columns.map((c) => c.label).join('\t')];
  for (const row of args.rows) {
    lines.push(
      args.columns
        .map((c) => cellToString(row[c.key]).replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
        .join('\t'),
    );
  }
  await navigator.clipboard.writeText(lines.join('\n'));
  return { rowCount: args.rows.length, colCount: args.columns.length };
}