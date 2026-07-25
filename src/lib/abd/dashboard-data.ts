// @deprecated (Phase 5 SSOT 이관 완료)
// ABD Dashboard 는 이제 abd_dashboard_row1/row2/status_dist/approval_trend/
// overdue_heatmap/attention_lists/crosscut RPC 만을 유일한 소스로 사용한다.
// 이 파일은 과거 대시보드가 사용하던 클라이언트 집계 유틸로, 신규 코드에서
// 참조하지 말 것. 다음 라운드에서 안전하게 제거 예정.

import { supabase } from "@/integrations/supabase/client";
import {
  differenceInDays,
  format,
  isAfter,
  parseISO,
  startOfDay,
  isValid,
} from "date-fns";

export type AbdStage = "Pending" | "R1" | "R2" | "R3" | "Approved";
export const ABD_STAGES: AbdStage[] = ["Pending", "R1", "R2", "R3", "Approved"];

export type Risk = "green" | "amber" | "red";

export interface CrossCutCell {
  key: string;
  total: number;
  approved: number;
  pending: number;
  overdue: number;
}

export interface AttentionItem {
  id: string;
  label: string;
  team: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  stage: AbdStage;
  daysLate?: number;
  daysWaiting?: number;
  daysIdle?: number;
}

export interface AbdDashboardData {
  asOf: string;
  total: number;
  approved: number;
  pending: number;
  overdue: number;
  awaitingResponse: number;
  stuck: number;
  stageCounts: Record<AbdStage, number>;
  risk: Record<Risk, number>;
  approvedByDay: Map<string, number>;
  topOverdue: AttentionItem[];
  topAwaiting: AttentionItem[];
  topStuck: AttentionItem[];
  byTeam: CrossCutCell[];
  byHdecPic: CrossCutCell[];
  byHdecEng: CrossCutCell[];
  byDis: CrossCutCell[];
  byBatch: CrossCutCell[];
}

type Row = {
  id: string;
  team: string | null;
  plot: string | null;
  dis: string | null;
  service: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  batch_no: string | null;
  document_title: string | null;
  abd_number: string | null;
  latest_status: string | null;
  status_group: string | null;
  approval_date: string | null;
  r1_draft_finish_plan: string | null;
  r1_draft_finish_actual: string | null;
  r1_submission_plan: string | null;
  r1_submission_actual: string | null;
  r1_dar_plan: string | null;
  r1_dar_actual: string | null;
  r2_draft_finish_actual: string | null;
  r2_submission_actual: string | null;
  r2_dar_plan: string | null;
  r2_dar_actual: string | null;
  r3_draft_finish_actual: string | null;
  r3_submission_actual: string | null;
  r3_dar_plan: string | null;
  r3_dar_actual: string | null;
  created_at: string | null;
};

const SELECT_COLS = [
  "id","team","plot","dis","service","hdec_pic_name","hdec_eng_name","batch_no","document_title","abd_number",
  "latest_status","status_group","approval_date",
  "r1_draft_finish_plan","r1_draft_finish_actual","r1_submission_plan","r1_submission_actual","r1_dar_plan","r1_dar_actual",
  "r2_draft_finish_actual","r2_submission_actual","r2_dar_plan","r2_dar_actual",
  "r3_draft_finish_actual","r3_submission_actual","r3_dar_plan","r3_dar_actual",
  "created_at",
].join(",");

function safeIso(v: string | null | undefined): Date | null {
  if (!v) return null;
  try {
    const d = parseISO(v);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function isApproved(row: Row): boolean {
  return (
    (row.latest_status ?? "").toUpperCase() === "A" ||
    row.status_group === "approved"
  );
}

function deriveStage(row: Row): AbdStage {
  if (isApproved(row)) return "Approved";
  if (row.r3_draft_finish_actual || row.r3_submission_actual || row.r3_dar_actual) return "R3";
  if (row.r2_draft_finish_actual || row.r2_submission_actual || row.r2_dar_actual) return "R2";
  if (row.r1_draft_finish_actual || row.r1_submission_actual || row.r1_dar_actual) return "R1";
  return "Pending";
}

/** 최종 target 날짜 — 가장 진행된 라운드의 DAR plan을 우선 사용. */
function targetDate(row: Row): Date | null {
  return (
    safeIso(row.r3_dar_plan) ??
    safeIso(row.r2_dar_plan) ??
    safeIso(row.r1_dar_plan) ??
    safeIso(row.r1_submission_plan) ??
    safeIso(row.r1_draft_finish_plan) ??
    null
  );
}

/** 스테이지 진입 시점(가장 최근 actual). Awaiting/Stuck 계산용. */
function lastActivity(row: Row): Date | null {
  return (
    safeIso(row.r3_dar_actual) ??
    safeIso(row.r3_submission_actual) ??
    safeIso(row.r3_draft_finish_actual) ??
    safeIso(row.r2_dar_actual) ??
    safeIso(row.r2_submission_actual) ??
    safeIso(row.r2_draft_finish_actual) ??
    safeIso(row.r1_dar_actual) ??
    safeIso(row.r1_submission_actual) ??
    safeIso(row.r1_draft_finish_actual) ??
    null
  );
}

/** 어떤 라운드의 Submission이 제출되었지만 아직 그 DAR가 없고 approved도 아니면 awaiting. */
function isAwaitingResponse(row: Row): boolean {
  if (isApproved(row)) return false;
  const submitted =
    !!row.r3_submission_actual || !!row.r2_submission_actual || !!row.r1_submission_actual;
  if (!submitted) return false;
  const darDone = !!row.r3_dar_actual || !!row.r2_dar_actual || !!row.r1_dar_actual;
  return !darDone;
}

function bumpCross(map: Map<string, CrossCutCell>, key: string | null | undefined, patch: Partial<CrossCutCell>) {
  const k = (key ?? "").trim() || "— Unassigned";
  const cur = map.get(k) ?? { key: k, total: 0, approved: 0, pending: 0, overdue: 0 };
  cur.total += patch.total ?? 0;
  cur.approved += patch.approved ?? 0;
  cur.pending += patch.pending ?? 0;
  cur.overdue += patch.overdue ?? 0;
  map.set(k, cur);
}

function fmtLabel(row: Row): string {
  const num = row.abd_number ?? row.id.slice(0, 8);
  const title = row.document_title ? ` — ${row.document_title}` : "";
  return `${num}${title}`;
}

async function fetchAllRows(opts: { batchNo?: string[] } = {}): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = (supabase as any)
      .from("abd_items_raw")
      .select(SELECT_COLS)
      .eq("is_active", true);
    if (opts.batchNo && opts.batchNo.length) q = q.in("batch_no", opts.batchNo);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as Row[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export async function loadAbdDashboardData(opts: { asOf?: Date; batchNo?: string[] } = {}): Promise<AbdDashboardData> {
  const asOf = startOfDay(opts.asOf ?? new Date());
  const rows = await fetchAllRows({ batchNo: opts.batchNo });

  const stageCounts: Record<AbdStage, number> = {
    Pending: 0, R1: 0, R2: 0, R3: 0, Approved: 0,
  };
  const risk: Record<Risk, number> = { green: 0, amber: 0, red: 0 };
  const approvedByDay = new Map<string, number>();
  const topOverdue: AttentionItem[] = [];
  const topAwaiting: AttentionItem[] = [];
  const topStuck: AttentionItem[] = [];
  const byTeam = new Map<string, CrossCutCell>();
  const byHdecPic = new Map<string, CrossCutCell>();
  const byHdecEng = new Map<string, CrossCutCell>();
  const byDis = new Map<string, CrossCutCell>();
  const byBatch = new Map<string, CrossCutCell>();

  let approved = 0;
  let overdue = 0;
  let awaiting = 0;
  let stuck = 0;

  for (const row of rows) {
    const stage = deriveStage(row);
    stageCounts[stage]++;
    const isDone = stage === "Approved";
    if (isDone) approved++;

    // 승인일별 트렌드
    const appIso = safeIso(row.approval_date);
    if (isDone && appIso) {
      const key = format(appIso, "yyyy-MM-dd");
      approvedByDay.set(key, (approvedByDay.get(key) ?? 0) + 1);
    }

    // 목표일 대비 리스크 / 지연
    const due = targetDate(row);
    let isOverdueRow = false;
    let daysLate = 0;
    if (!isDone && due) {
      const days = differenceInDays(due, asOf);
      if (days < 0) {
        risk.red++;
        isOverdueRow = true;
        daysLate = -days;
        overdue++;
        topOverdue.push({
          id: row.id,
          label: fmtLabel(row),
          team: row.team,
          hdec_pic_name: row.hdec_pic_name,
          hdec_eng_name: row.hdec_eng_name,
          stage,
          daysLate,
        });
      } else if (days < 14) {
        risk.amber++;
      } else {
        risk.green++;
      }
    } else if (!isDone && !due) {
      risk.amber++;
    } else {
      risk.green++;
    }

    // Awaiting response
    if (isAwaitingResponse(row)) {
      awaiting++;
      const since = lastActivity(row);
      topAwaiting.push({
        id: row.id,
        label: fmtLabel(row),
        team: row.team,
        hdec_pic_name: row.hdec_pic_name,
        hdec_eng_name: row.hdec_eng_name,
        stage,
        daysWaiting: since ? Math.max(0, differenceInDays(asOf, since)) : 0,
      });
    }

    // Stuck: Pending 인데 14일 이상 아무 활동 없음 (created_at 기준)
    if (stage === "Pending") {
      const created = safeIso(row.created_at);
      if (created) {
        const idle = differenceInDays(asOf, created);
        if (idle > 14) {
          stuck++;
          topStuck.push({
            id: row.id,
            label: fmtLabel(row),
            team: row.team,
            hdec_pic_name: row.hdec_pic_name,
            hdec_eng_name: row.hdec_eng_name,
            stage,
            daysIdle: idle,
          });
        }
      }
    }

    // 크로스컷
    const patch = {
      total: 1,
      approved: isDone ? 1 : 0,
      pending: isDone ? 0 : 1,
      overdue: isOverdueRow ? 1 : 0,
    };
    bumpCross(byTeam, row.team, patch);
    bumpCross(byHdecPic, row.hdec_pic_name, patch);
    bumpCross(byHdecEng, row.hdec_eng_name, patch);
    bumpCross(byDis, row.dis, patch);
    bumpCross(byBatch, row.batch_no, patch);

    // isAfter usage to keep tree-shake happy on strict configs
    void isAfter;
  }

  const sortDesc = <T extends AttentionItem>(arr: T[], key: keyof AttentionItem) =>
    arr.sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0)).slice(0, 8);

  return {
    asOf: format(asOf, "yyyy-MM-dd"),
    total: rows.length,
    approved,
    pending: rows.length - approved,
    overdue,
    awaitingResponse: awaiting,
    stuck,
    stageCounts,
    risk,
    approvedByDay,
    topOverdue: sortDesc(topOverdue, "daysLate"),
    topAwaiting: sortDesc(topAwaiting, "daysWaiting"),
    topStuck: sortDesc(topStuck, "daysIdle"),
    byTeam: Array.from(byTeam.values()).sort((a, b) => b.total - a.total),
    byHdecPic: Array.from(byHdecPic.values()).sort((a, b) => b.total - a.total),
    byHdecEng: Array.from(byHdecEng.values()).sort((a, b) => b.total - a.total),
    byDis: Array.from(byDis.values()).sort((a, b) => b.total - a.total),
    byBatch: Array.from(byBatch.values()).sort((a, b) => b.total - a.total),
  };
}

/** approval_date 를 asOf 기준 최근 30일 일자 배열로 변환. */
export function buildTrendSeries(data: AbdDashboardData, days = 30): Array<{ date: string; approved: number }> {
  const out: Array<{ date: string; approved: number }> = [];
  const asOf = parseISO(data.asOf);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(asOf);
    d.setDate(d.getDate() - i);
    const key = format(d, "yyyy-MM-dd");
    out.push({ date: key, approved: data.approvedByDay.get(key) ?? 0 });
  }
  return out;
}