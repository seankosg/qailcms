export type DmrDiscipline = 'ARCH' | 'ELEC' | 'MECH';

/** Daily Entry 화면이 쓰는 행 모양. 화면 1행 = 저장 1건. */
export interface EntryRow {
  key: string;
  /** 공종 — 하루치 기록은 ARCH·ELEC·MECH 가 한 표에 섞인다 */
  discipline: DmrDiscipline;
  task_no: string;
  system_name: string;
  /** Task/Subtask 직접 입력값 — 비어 있으면 TM 정본 명칭을 따른다 */
  task_name?: string;
  /** Work Type 직접 입력값 — TM 코드 없는 행에서만 사용 */
  work_type?: string;
  contractor_name: string;
  plot: 'C' | 'D';
  pic_name: string;
  /** 총원 — 인원 종류 구분 없이 한 칸 */
  manpower: string;
  saved?: boolean;
  /** 스크린샷 파싱으로 채워 넣은 행 */
  imported?: boolean;
  /** TM 에서 코드를 찾지 못한 파싱 행 */
  unmatched?: boolean;
  /** 한 줄에 코드가 여럿 */
  multiCode?: boolean;
  /** 스크린샷에서 불러온 원래 순서 — 기본 정렬에 쓰인다 */
  importIndex?: number;
  /** 저장 당시 박힌 TM 값 — 불러온 행은 재계산하지 않는다 */
  snap?: {
    task_name: string | null;
    work_category: string | null;
    tplan_pct: number | null;
    tactual_pct: number | null;
    task_data_date: string | null;
  };
}

export interface TmOption {
  task_no: string;
  task_name: string | null;
  level: string | null;
  row_type: string | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  /** 기준일 하루치 증분 — 서버 tm_rows_as_of 정본 */
  tc_plan_pct: number | null;
  tc_actual_pct: number | null;
  data_date: string | null;
  plot: string | null;
  effective_pic: string | null;
  original_pic: string | null;
  is_delegated: boolean | null;
}

let seq = 0;
export const newEntryRow = (init: Partial<EntryRow> = {}): EntryRow => ({
  key: `r${++seq}`,
  discipline: 'ARCH',
  task_no: '',
  system_name: '',
  contractor_name: '',
  plot: 'C',
  pic_name: '',
  manpower: '0',
  ...init,
});
