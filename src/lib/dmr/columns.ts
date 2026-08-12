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

/**
 * Raw Data 2 — Daily Entry 저장 결과를 그대로 비추는 열 묶음.
 * 행 단위는 DB 원본(인원종류별 3행)이며, 열 순서는 Daily Entry 입력 표와 같다.
 */
export const DMR2_COLUMNS: DmrColumnDef[] = [
  { key: 'report_date', label: 'Date', type: 'date', width: 110, filterType: 'date-range', serverFacet: 'report_date' },
  { key: 'plot', label: 'Plot', type: 'enum', width: 70, filterType: 'multi-select', serverFacet: 'plot', enumOptions: ['C', 'D'] },
  { key: 'discipline', label: 'Team', type: 'enum', width: 80, filterType: 'multi-select', serverFacet: 'discipline', enumOptions: ['ARCH', 'ELEC', 'MECH'] },
  { key: 'task_no', label: 'Task No (TM Code)', type: 'text', width: 150, filterType: 'multi-select', serverFacet: 'task_no' },
  { key: 'task_name', label: 'Task / Subtask', type: 'text', width: 260, filterType: 'text' },
  { key: 'pic_name', label: 'HDEC PIC', type: 'text', width: 120, filterType: 'multi-select', serverFacet: 'pic_name' },
  { key: 'work_category', label: 'Work Type', type: 'text', width: 110, filterType: 'multi-select', serverFacet: 'work_category' },
  { key: 'contractor_name', label: 'Sub Contractor', type: 'text', width: 200, filterType: 'multi-select', serverFacet: 'contractor_name' },
  { key: 'system_name', label: 'System', type: 'text', width: 220, filterType: 'multi-select', serverFacet: 'system_name' },
  { key: 'tc_plan_pct', label: 'TC Plan %', type: 'number', width: 100, align: 'right', filterType: 'number-range' },
  { key: 'tc_actual_pct', label: 'TC Actual %', type: 'number', width: 100, align: 'right', filterType: 'number-range' },
  { key: 'headcount_kind', label: '인원 종류', type: 'enum', width: 110, filterType: 'multi-select', serverFacet: 'headcount_kind', enumOptions: ['worker', 'foreman', 'supervisor'] },
  { key: 'actual_manpower', label: '인원', type: 'number', width: 90, align: 'right', filterType: 'number-range' },
];

export const DMR2_COLUMN_KEYS = DMR2_COLUMNS.map((c) => c.key);

export const DMR2_COLUMN_BY_KEY: Record<string, DmrColumnDef> = Object.fromEntries(
  DMR2_COLUMNS.map((c) => [c.key, c]),
);