import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";

const TM_LIMIT_USER = 2000;
const TM_LIMIT_ADMIN = 5000;

function daysBetween(iso: string, base: string): number {
  const a = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${base.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((a - b) / 86_400_000);
}

async function fetchAll<T = any>(
  table: string,
  select: string,
  applyFilter: (q: any) => any,
  order: { col: string; asc?: boolean } | null,
  limit: number,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1;
    let q = (supabase as any).from(table).select(select);
    q = applyFilter(q);
    if (order) q = q.order(order.col, { ascending: order.asc ?? true, nullsFirst: false });
    const { data, error } = await q.range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < to - from + 1) break;
  }
  return out;
}

// ==================== TM ====================
export interface TmMyRow {
  id: string;
  task_no: string | null;
  main_task_no: string | null;
  task_name: string | null;
  level: string | null;
  hdec_pic_name: string | null;
  plan_end: string | null;
  actual_progress: number | null;
  auto_judgment: string | null;
}

export function useMyTasks(filterPic: string | null, isAdmin: boolean) {
  return useQuery({
    queryKey: ["my-workspace", "tm", filterPic, isAdmin],
    enabled: isAdmin || !!filterPic,
    staleTime: 60_000,
    queryFn: async () => {
      const limit = isAdmin ? TM_LIMIT_ADMIN : TM_LIMIT_USER;
      const rows = await fetchAll<TmMyRow>(
        "task_management_raw",
        "id,task_no,main_task_no,task_name,level,hdec_pic_name,plan_end,actual_progress,auto_judgment",
        (q) => (isAdmin ? q : q.eq("hdec_pic_name", filterPic)),
        { col: "task_no", asc: true },
        limit,
      );
      return rows;
    },
  });
}

export function tmIsCompleted(r: TmMyRow): boolean {
  return (Number(r.actual_progress ?? 0) >= 1) || r.auto_judgment === "완료";
}
export function tmIsStarted(r: TmMyRow): boolean {
  return !tmIsCompleted(r) && Number(r.actual_progress ?? 0) > 0;
}
export function tmIsDelayed(r: TmMyRow): boolean {
  if (tmIsCompleted(r)) return false;
  return r.auto_judgment === "지연" || r.auto_judgment === "위험";
}
export function tmIsUpcoming(r: TmMyRow, today: string, days = 3): boolean {
  if (tmIsCompleted(r)) return false;
  if (!r.plan_end) return false;
  const d = daysBetween(r.plan_end, today);
  return d >= 0 && d <= days;
}

// ==================== SM ====================
export interface SmMyRow {
  id: string;
  source_issue_no: string | null;
  location_raw: string | null;
  main_trade: string | null;
  status_raw: string | null;
  planned_closure_date: string | null;
  planned_rectified_date: string | null;
  actual_closure_date: string | null;
  actual_rectified_date: string | null;
  actual_progress_pct: number | null;
  created_date: string | null;
  hdec_pic_name: string | null;
}

export function useMyDefects(filterPic: string | null, isAdmin: boolean) {
  return useQuery({
    queryKey: ["my-workspace", "sm", filterPic, isAdmin],
    enabled: isAdmin || !!filterPic,
    staleTime: 60_000,
    queryFn: async () => {
      const limit = isAdmin ? TM_LIMIT_ADMIN : TM_LIMIT_USER;
      const rows = await fetchAll<SmMyRow>(
        "defect_items_raw",
        "id,source_issue_no,location_raw,main_trade,status_raw,planned_closure_date,planned_rectified_date,actual_closure_date,actual_rectified_date,actual_progress_pct,created_date,hdec_pic_name",
        (q) => (isAdmin ? q : q.eq("hdec_pic_name", filterPic)),
        { col: "source_issue_no", asc: true },
        limit,
      );
      return rows;
    },
  });
}

const SM_CLOSED = new Set(["closed", "verified"]);
const SM_RECTIFIED = new Set(["rectified", "complete", "completed"]);

export function smIsCompleted(r: SmMyRow): boolean {
  const s = String(r.status_raw ?? "").trim().toLowerCase();
  if (SM_CLOSED.has(s) || SM_RECTIFIED.has(s)) return true;
  return !!(r.actual_closure_date || r.actual_rectified_date);
}
export function smIsDelayed(r: SmMyRow, today: string): boolean {
  if (smIsCompleted(r)) return false;
  const due = r.planned_closure_date ?? r.planned_rectified_date;
  if (!due) return false;
  return daysBetween(due, today) < 0;
}
export function smIsInProgress(r: SmMyRow): boolean {
  if (smIsCompleted(r)) return false;
  const s = String(r.status_raw ?? "").trim().toLowerCase();
  if (s === "in progress" || s === "inprogress" || s === "wip" || s === "under review") return true;
  return Number(r.actual_progress_pct ?? 0) > 0;
}
export function smIsUpcoming(r: SmMyRow, today: string, days = 3): boolean {
  if (smIsCompleted(r)) return false;
  const due = r.planned_closure_date ?? r.planned_rectified_date;
  if (!due) return false;
  const d = daysBetween(due, today);
  return d >= 0 && d <= days;
}

// ==================== ABD ====================
export interface AbdMyRow {
  id: string;
  abd_number: string | null;
  document_title: string | null;
  latest_status: string | null;
  latest_rev: string | null;
  hdec_pic_name: string | null;
  r1_drafting_plan: string | null; r1_drafting_actual: string | null;
  r1_submission_plan: string | null; r1_submission_actual: string | null;
  r1_dar_plan: string | null; r1_dar_actual: string | null;
  r2_drafting_plan: string | null; r2_drafting_actual: string | null;
  r2_submission_plan: string | null; r2_submission_actual: string | null;
  r2_dar_plan: string | null; r2_dar_actual: string | null;
  r3_drafting_plan: string | null; r3_drafting_actual: string | null;
  r3_submission_plan: string | null; r3_submission_actual: string | null;
  r3_dar_plan: string | null; r3_dar_actual: string | null;
}

export function useMyAbd(filterPic: string | null, isAdmin: boolean) {
  return useQuery({
    queryKey: ["my-workspace", "abd", filterPic, isAdmin],
    enabled: isAdmin || !!filterPic,
    staleTime: 60_000,
    queryFn: async () => {
      const limit = isAdmin ? TM_LIMIT_ADMIN : TM_LIMIT_USER;
      const cols = [
        "id,abd_number,document_title,latest_status,latest_rev,hdec_pic_name",
        "r1_drafting_plan,r1_drafting_actual,r1_submission_plan,r1_submission_actual,r1_dar_plan,r1_dar_actual",
        "r2_drafting_plan,r2_drafting_actual,r2_submission_plan,r2_submission_actual,r2_dar_plan,r2_dar_actual",
        "r3_drafting_plan,r3_drafting_actual,r3_submission_plan,r3_submission_actual,r3_dar_plan,r3_dar_actual",
      ].join(",");
      const rows = await fetchAll<AbdMyRow>(
        "abd_items_raw",
        cols,
        (q) => {
          const base = q.eq("is_active", true);
          return isAdmin ? base : base.eq("hdec_pic_name", filterPic);
        },
        { col: "abd_number", asc: true },
        limit,
      );
      return rows;
    },
  });
}

export function abdIsApproved(r: AbdMyRow): boolean {
  return String(r.latest_status ?? "").toUpperCase() === "A";
}
export type AbdRoundStage = "Approved" | "R3" | "R2" | "R1" | "Pending";
export function abdStage(r: AbdMyRow): AbdRoundStage {
  if (abdIsApproved(r)) return "Approved";
  if (r.r3_drafting_actual || r.r3_submission_actual || r.r3_dar_actual) return "R3";
  if (r.r2_drafting_actual || r.r2_submission_actual || r.r2_dar_actual) return "R2";
  if (r.r1_drafting_actual || r.r1_submission_actual || r.r1_dar_actual) return "R1";
  return "Pending";
}
function abdCurrentPlan(r: AbdMyRow): string | null {
  const st = abdStage(r);
  if (st === "R3") return r.r3_dar_plan ?? r.r3_submission_plan ?? r.r3_drafting_plan ?? null;
  if (st === "R2") return r.r2_dar_plan ?? r.r2_submission_plan ?? r.r2_drafting_plan ?? null;
  if (st === "R1" || st === "Pending") return r.r1_dar_plan ?? r.r1_submission_plan ?? r.r1_drafting_plan ?? null;
  return null;
}
export function abdIsInProgress(r: AbdMyRow): boolean {
  const st = abdStage(r);
  return st === "R1" || st === "R2" || st === "R3";
}
export function abdIsDelayed(r: AbdMyRow, today: string): boolean {
  if (abdIsApproved(r)) return false;
  const plan = abdCurrentPlan(r);
  if (!plan) return false;
  return daysBetween(plan, today) < 0;
}
export function abdIsUpcoming(r: AbdMyRow, today: string, days = 3): boolean {
  if (abdIsApproved(r)) return false;
  const plan = abdCurrentPlan(r);
  if (!plan) return false;
  const d = daysBetween(plan, today);
  return d >= 0 && d <= days;
}
export function abdCurrentPlanDate(r: AbdMyRow): string | null {
  return abdCurrentPlan(r);
}

export function today(): string {
  return todayInDoha();
}