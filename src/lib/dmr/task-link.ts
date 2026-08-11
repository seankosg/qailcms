/**
 * 출면기록부 ↔ TM 과업 연결 — 읽기 시점 파생값.
 *
 * 저장하지 않는 값만 여기서 만든다.
 *  - 당일 증분(daily delta): 같은 task_no 의 직전 DMR 행 tactual_pct 와의 차
 *  - Data Date 격차: report_date − task_data_date (일)
 *
 * 규칙(변경 금지):
 *  - 직전 행이 없으면 null. 0 이 아니다.
 *  - 음수는 음수 그대로. 0 으로 클램프하지 않는다.
 *  - 증분은 절대 컬럼으로 저장하지 않는다. 누계가 원자료다.
 *  - tm_today_actual 을 쓰지 않는다(관측 없는 날에 중복 귀속됨).
 */

export type DmrHeadcountKind = 'worker' | 'foreman' | 'supervisor';

export const DMR_HEADCOUNT_KINDS: DmrHeadcountKind[] = ['worker', 'foreman', 'supervisor'];

export const DMR_HEADCOUNT_KIND_LABEL: Record<DmrHeadcountKind, string> = {
  worker: 'Worker',
  foreman: 'Foreman',
  supervisor: 'Supervisor',
};

export interface DmrTaskLinkedRow {
  report_date: string;
  task_no: string | null;
  tactual_pct: number | null;
  tplan_pct: number | null;
  task_data_date: string | null;
}

function toDays(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * report_date 와 task_data_date 의 차이(일). 저장하지 않고 읽을 때 계산한다.
 * 0 이 아니면 화면에서 반드시 눈에 띄게 표시할 것.
 */
export function dmrDataDateGapDays(row: Pick<DmrTaskLinkedRow, 'report_date' | 'task_data_date'>): number | null {
  if (!row.report_date || !row.task_data_date) return null;
  return toDays(row.report_date, row.task_data_date);
}

/**
 * task_no 별 당일 증분 맵을 만든다. key = `${task_no}|${report_date}`.
 * 같은 task_no·report_date 에 여러 행(headcount_kind 등)이 있으면 누계는 동일하므로
 * 대표 1건의 tactual_pct 를 쓴다.
 */
export function buildDmrDailyDeltaMap(rows: DmrTaskLinkedRow[]): Map<string, number | null> {
  const byTask = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    if (!r.task_no || !r.report_date) continue;
    let m = byTask.get(r.task_no);
    if (!m) {
      m = new Map();
      byTask.set(r.task_no, m);
    }
    if (!m.has(r.report_date)) m.set(r.report_date, r.tactual_pct ?? null);
  }

  const out = new Map<string, number | null>();
  for (const [taskNo, m] of byTask) {
    const dates = [...m.keys()].sort();
    let prev: number | null = null;
    let hasPrev = false;
    for (const d of dates) {
      const cur = m.get(d) ?? null;
      const delta = hasPrev && prev != null && cur != null ? cur - prev : null;
      out.set(`${taskNo}|${d}`, delta);
      if (cur != null) {
        prev = cur;
        hasPrev = true;
      }
    }
  }
  return out;
}

export function dmrDailyDelta(
  deltaMap: Map<string, number | null>,
  row: Pick<DmrTaskLinkedRow, 'task_no' | 'report_date'>,
): number | null {
  if (!row.task_no) return null;
  return deltaMap.get(`${row.task_no}|${row.report_date}`) ?? null;
}