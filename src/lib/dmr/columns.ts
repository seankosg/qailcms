export type DmrColumnType = 'text' | 'number' | 'date' | 'enum';

export interface DmrColumnDef {
  key: string;
  label: string;
  type: DmrColumnType;
  width: number;
  align?: 'left' | 'right' | 'center';
  enumOptions?: string[];
  editable?: boolean;
  editorType?: 'text' | 'select' | 'date' | 'number';
  filterType: 'multi-select' | 'text' | 'date-range' | 'number-range';
  serverFacet?: string; // dmr_facets column name
  derived?: boolean;
}

export const DMR_COLUMNS: DmrColumnDef[] = [
  {
    key: 'report_date',
    label: 'Date',
    type: 'date',
    width: 110,
    filterType: 'date-range',
    editable: true,
    editorType: 'date',
  },
  {
    key: 'discipline',
    label: 'TEAM',
    type: 'enum',
    width: 80,
    filterType: 'multi-select',
    serverFacet: 'discipline',
    enumOptions: ['ARCH', 'ELEC', 'MECH'],
    editable: true,
    editorType: 'select',
  },
  {
    key: 'system_name',
    label: 'Work Description',
    type: 'text',
    width: 220,
    filterType: 'multi-select',
    serverFacet: 'system_name',
    editable: true,
    editorType: 'text',
  },
  {
    key: 'contractor_name',
    label: 'Sub Contractor',
    type: 'text',
    width: 220,
    filterType: 'multi-select',
    serverFacet: 'contractor_name',
    editable: true,
    editorType: 'text',
  },
  {
    key: 'direct_flag',
    label: '유형',
    type: 'enum',
    width: 80,
    filterType: 'multi-select',
    serverFacet: 'direct_flag',
    enumOptions: ['direct', 'sub'],
    derived: true,
  },
  {
    key: 'plot',
    label: 'Plot',
    type: 'enum',
    width: 70,
    filterType: 'multi-select',
    serverFacet: 'plot',
    enumOptions: ['C', 'D', 'TOTAL'],
    editable: true,
    editorType: 'select',
  },
  {
    key: 'plan_manpower',
    label: 'Plan (계획)',
    type: 'number',
    width: 100,
    align: 'right',
    filterType: 'number-range',
    editable: true,
    editorType: 'number',
  },
  {
    key: 'actual_manpower',
    label: 'Actual (실적)',
    type: 'number',
    width: 100,
    align: 'right',
    filterType: 'number-range',
    editable: true,
    editorType: 'number',
  },
  {
    key: 'diff_manpower',
    label: 'Δ (Actual−Plan)',
    type: 'number',
    width: 130,
    align: 'right',
    filterType: 'number-range',
    derived: true,
  },
];

export const DMR_COLUMN_KEYS = DMR_COLUMNS.map((c) => c.key);

export const DMR_COLUMN_BY_KEY: Record<string, DmrColumnDef> = Object.fromEntries(
  DMR_COLUMNS.map((c) => [c.key, c]),
);