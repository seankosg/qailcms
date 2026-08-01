import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";
import {
  computeJudgment,
  isTaskDelayed,
  DEFAULT_THRESHOLDS,
  type TaskThresholds,
  type JudgmentRow,
} from "@/lib/task-management/derived";

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
  limit: number | null,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  const MAX_PAGES = 200; // 안전장치: 최대 200k행
  const effectiveLimit = limit ?? MAX_PAGES * PAGE;
  for (let from = 0; from < effectiveLimit; from += PAGE) {
    const to = Math.min(from + PAGE, effectiveLimit) - 1;
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
  plan_start: string | null;
  plan_days: number | null;
  plan_progress: number | null;
  data_date: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  slip_days: number | null;
  created_at: string | null;
}

export type MwsScope = "pic" | "team";

/** 완료 판정 — 정본 정의(실적 100% 또는 실적 종료일 존재). 판정 문자열은 참조하지 않는다. */
export function tmIsCompleted(r: TmMyRow): boolean {
  return Number(r.actual_progress ?? 0) >= 1 || !!r.actual_finish;
}
export function tmIsStarted(r: TmMyRow): boolean {
  return !tmIsCompleted(r) && Number(r.actual_progress ?? 0) > 0;
}
// 지연/판정 사본 제거: MWS 는 서버 정본(tm_rows_as_of → auto_judgment)만 사용한다.
export function tmIsUpcoming(r: TmMyRow, today: string, days = 3): boolean {
  if (tmIsCompleted(r)) return false;
  if (!r.plan_end) return false;
  const d = daysBetween(r.plan_end, today);
  return d >= 1 && d <= days;
}

function sameDay(a: string | null | undefined, today: string): boolean {
  if (!a) return false;
  return String(a).slice(0, 10) === today.slice(0, 10);
}

export type TmTodayKind = "Start" | "Finish";
export function tmTodayKinds(r: TmMyRow, today: string): TmTodayKind[] {
  if (tmIsCompleted(r)) return [];
  const kinds: TmTodayKind[] = [];
  if (sameDay(r.plan_start, today)) kinds.push("Start");
  if (sameDay(r.plan_end, today)) kinds.push("Finish");
  return kinds;
}
export function tmIsToday(r: TmMyRow, today: string): boolean {
  return tmTodayKinds(r, today).length > 0;
}


// ==================== SM ====================
export interface SmMyRow {
  id: string;
  source_issue_no: string | null;
  location_raw: string | null;
  main_trade: string | null;
  status_raw: string | null;
  planned_start_date: string | null;
  planned_closure_date: string | null;
  planned_rectified_date: string | null;
  actual_closure_date: string | null;
  actual_rectified_date: string | null;
  actual_progress_pct: number | null;
  created_date: string | null;
  created_at: string | null;
  hdec_pic_name: string | null;
}

export function useMyDefects(filterValue: string | null, isAdmin: boolean, mode: MwsScope = "pic") {
  return useQuery({
    queryKey: ["my-workspace", "sm", mode, filterValue, isAdmin],
    enabled: isAdmin || !!filterValue,
    staleTime: 60_000,
    queryFn: async () => {
      // Step 1: 상한 제거 — 서버 RPC 도입 이전에도 잘림 방지.
      // (실사용은 useMyDefectsCounts/Bucket 조합으로 대체됨)
      const limit = 100_000;
      const rows = await fetchAll<SmMyRow>(
        "defect_items_raw",
        "id,source_issue_no,location_raw,main_trade,status_raw,planned_start_date,planned_closure_date,planned_rectified_date,actual_closure_date,actual_rectified_date,actual_progress_pct,created_date,created_at,hdec_pic_name",
        (q) => (isAdmin ? q : q.eq(mode === "team" ? "team" : "hdec_pic_name", filterValue)),
        { col: "source_issue_no", asc: true },
        limit,
      );
      return rows;
    },
  });
}

// ============ Step 2: 서버 판정 RPC 훅 ============
export type SmBucket = "today" | "delayed" | "upcoming" | "in_progress" | "completed";

export interface SmMyCounts {
  today_count: number;
  delayed_count: number;
  upcoming_count: number;
  in_progress_count: number;
  completed_count: number;
  total_count: number;
}

function smRpcMode(isAdmin: boolean, scope: MwsScope): "admin" | "pic" | "team" {
  if (isAdmin) return "admin";
  return scope === "team" ? "team" : "pic";
}

function mwsRpcMode(isAdmin: boolean, scope: MwsScope): "admin" | "pic" | "team" {
  return smRpcMode(isAdmin, scope);
}

export function useMyDefectsCounts(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
) {
  const mode = smRpcMode(isAdmin, scope);
  return useQuery<SmMyCounts>({
    queryKey: ["my-workspace", "sm-counts", mode, filterValue, todayIso],
    enabled: isAdmin || !!filterValue,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("sm_my_workspace_counts", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
      });
      if (error) throw new Error(error.message);
      const row = (data ?? [])[0] ?? {};
      return {
        today_count: Number(row.today_count ?? 0),
        delayed_count: Number(row.delayed_count ?? 0),
        upcoming_count: Number(row.upcoming_count ?? 0),
        in_progress_count: Number(row.in_progress_count ?? 0),
        completed_count: Number(row.completed_count ?? 0),
        total_count: Number(row.total_count ?? 0),
      };
    },
  });
}

export function useMyDefectsBucket(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
  bucket: SmBucket | null,
  opts?: { limit?: number; enabled?: boolean },
) {
  const mode = smRpcMode(isAdmin, scope);
  const enabledBase = isAdmin || !!filterValue;
  return useQuery<SmMyRow[]>({
    queryKey: ["my-workspace", "sm-bucket", mode, filterValue, todayIso, bucket, opts?.limit ?? 5000],
    enabled: enabledBase && !!bucket && (opts?.enabled !== false),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("sm_my_workspace_rows", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
        _bucket: bucket,
        _limit: opts?.limit ?? 5000,
        _offset: 0,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as SmMyRow[];
    },
  });
}

// ============ R4: TM/ABD 서버 판정 RPC 훅 ============
export type TmBucket = "today" | "delayed" | "upcoming" | "in_progress" | "completed" | "all";
export type AbdBucket = "today" | "delayed" | "upcoming" | "in_progress" | "completed" | "needs_planning" | "all";

export interface TmMyCounts {
  today_count: number;
  delayed_count: number;
  upcoming_count: number;
  in_progress_count: number;
  completed_count: number;
  total_count: number;
}
export interface AbdMyCounts extends TmMyCounts { needs_planning_count: number; }

export function useMyTasksCounts(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
  opts?: { enabled?: boolean },
) {
  const mode = mwsRpcMode(isAdmin, scope);
  return useQuery<TmMyCounts>({
    queryKey: ["my-workspace", "tm-counts", mode, filterValue, todayIso],
    enabled: (isAdmin || !!filterValue) && (opts?.enabled !== false),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("tm_my_workspace_counts", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
      });
      if (error) throw new Error(error.message);
      const row = (data ?? {}) as any;
      return {
        today_count: Number(row.today_count ?? 0),
        delayed_count: Number(row.delayed_count ?? 0),
        upcoming_count: Number(row.upcoming_count ?? 0),
        in_progress_count: Number(row.in_progress_count ?? 0),
        completed_count: Number(row.completed_count ?? 0),
        total_count: Number(row.total_count ?? 0),
      };
    },
  });
}

export function useMyTasksBucket(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
  bucket: TmBucket | null,
  opts?: { limit?: number; enabled?: boolean },
) {
  const mode = mwsRpcMode(isAdmin, scope);
  return useQuery<TmMyRow[]>({
    queryKey: ["my-workspace", "tm-bucket", mode, filterValue, todayIso, bucket, opts?.limit ?? 5000],
    enabled: (isAdmin || !!filterValue) && !!bucket && (opts?.enabled !== false),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("tm_my_workspace_rows", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
        _bucket: bucket,
        _limit: opts?.limit ?? 5000,
        _offset: 0,
      });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as TmMyRow[];
    },
  });
}

export function useMyAbdCounts(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
  opts?: { enabled?: boolean },
) {
  const mode = mwsRpcMode(isAdmin, scope);
  return useQuery<AbdMyCounts>({
    queryKey: ["my-workspace", "abd-counts", mode, filterValue, todayIso],
    enabled: (isAdmin || !!filterValue) && (opts?.enabled !== false),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_my_workspace_counts", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
      });
      if (error) throw new Error(error.message);
      const row = (data ?? {}) as any;
      return {
        today_count: Number(row.today_count ?? 0),
        delayed_count: Number(row.delayed_count ?? 0),
        upcoming_count: Number(row.upcoming_count ?? 0),
        in_progress_count: Number(row.in_progress_count ?? 0),
        completed_count: Number(row.completed_count ?? 0),
        needs_planning_count: Number(row.needs_planning_count ?? 0),
        total_count: Number(row.total_count ?? 0),
      };
    },
  });
}

export function useMyAbdBucket(
  filterValue: string | null,
  isAdmin: boolean,
  scope: MwsScope,
  todayIso: string,
  bucket: AbdBucket | null,
  opts?: { limit?: number; enabled?: boolean },
) {
  const mode = mwsRpcMode(isAdmin, scope);
  return useQuery<AbdMyRow[]>({
    queryKey: ["my-workspace", "abd-bucket", mode, filterValue, todayIso, bucket, opts?.limit ?? 5000],
    enabled: (isAdmin || !!filterValue) && !!bucket && (opts?.enabled !== false),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_my_workspace_rows", {
        _mode: mode,
        _filter_value: mode === "admin" ? null : filterValue,
        _today: todayIso,
        _bucket: bucket,
        _limit: opts?.limit ?? 5000,
        _offset: 0,
      });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as AbdMyRow[];
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
  return d >= 1 && d <= days;
}

export type SmTodayKind = "Start" | "Rectify" | "Close";
export function smTodayKinds(r: SmMyRow, today: string): SmTodayKind[] {
  if (smIsCompleted(r)) return [];
  const kinds: SmTodayKind[] = [];
  if (sameDay(r.planned_start_date, today)) kinds.push("Start");
  if (sameDay(r.planned_rectified_date, today)) kinds.push("Rectify");
  if (sameDay(r.planned_closure_date, today)) kinds.push("Close");
  return kinds;
}
export function smIsToday(r: SmMyRow, today: string): boolean {
  return smTodayKinds(r, today).length > 0;
}


// ==================== ABD ====================
export interface AbdMyRow {
  id: string;
  abd_number: string | null;
  document_title: string | null;
  latest_status: string | null;
  latest_rev: string | null;
  hdec_pic_name: string | null;
  needs_planning: boolean | null;
  active_round: number | null;
  is_terminated: boolean | null;
  r1_response_result: string | null;
  r2_response_result: string | null;
  r3_response_result: string | null;
  r1_draft_finish_plan: string | null; r1_draft_finish_actual: string | null;
  r1_submission_plan: string | null; r1_submission_actual: string | null;
  r1_dar_plan: string | null; r1_dar_actual: string | null;
  r2_draft_finish_plan: string | null; r2_draft_finish_actual: string | null;
  r2_submission_plan: string | null; r2_submission_actual: string | null;
  r2_dar_plan: string | null; r2_dar_actual: string | null;
  r3_draft_finish_plan: string | null; r3_draft_finish_actual: string | null;
  r3_submission_plan: string | null; r3_submission_actual: string | null;
  r3_dar_plan: string | null; r3_dar_actual: string | null;
  created_at: string | null;
}

export function useMyAbd(filterValue: string | null, isAdmin: boolean, mode: MwsScope = "pic") {
  return useQuery({
    queryKey: ["my-workspace", "abd", mode, filterValue, isAdmin],
    enabled: isAdmin || !!filterValue,
    staleTime: 60_000,
    queryFn: async () => {
      const cols = [
        "id,abd_number,document_title,latest_status,latest_rev,hdec_pic_name,created_at,needs_planning,active_round,is_terminated,r1_response_result,r2_response_result,r3_response_result",
        "r1_draft_finish_plan,r1_draft_finish_actual,r1_submission_plan,r1_submission_actual,r1_dar_plan,r1_dar_actual",
        "r2_draft_finish_plan,r2_draft_finish_actual,r2_submission_plan,r2_submission_actual,r2_dar_plan,r2_dar_actual",
        "r3_draft_finish_plan,r3_draft_finish_actual,r3_submission_plan,r3_submission_actual,r3_dar_plan,r3_dar_actual",
      ].join(",");
      const rows = await fetchAll<AbdMyRow>(
        "abd_items_raw",
        cols,
        (q) => {
          const base = q.eq("is_active", true);
          return isAdmin ? base : base.eq(mode === "team" ? "team" : "hdec_pic_name", filterValue);
        },
        { col: "abd_number", asc: true },
        null,
      );
      return rows;
    },
  });
}

export function abdIsApproved(r: AbdMyRow): boolean {
  return String(r.latest_status ?? "").toUpperCase() === "A";
}

/** Response=B/C 인데 다음 라운드 DS/DF/Sub 계획이 하나도 없는 경우 */
export function abdNeedsPlanning(r: AbdMyRow): boolean {
  if (r.needs_planning === true) return true;
  if (r.is_terminated) return false;
  if (abdIsApproved(r)) return false;
  const check = (res: string | null | undefined, plans: Array<string | null>) => {
    const rr = String(res ?? "").toUpperCase();
    if (rr !== "B" && rr !== "C") return false;
    return plans.every((p) => !p);
  };
  if (check(r.r1_response_result, [r.r2_draft_finish_plan, r.r2_submission_plan])) return true;
  if (check(r.r2_response_result, [r.r3_draft_finish_plan, r.r3_submission_plan])) return true;
  return false;
}

export function abdNextPlanRoundLabel(r: AbdMyRow): string | null {
  const rr1 = String(r.r1_response_result ?? "").toUpperCase();
  const rr2 = String(r.r2_response_result ?? "").toUpperCase();
  if ((rr2 === "B" || rr2 === "C") && !(r.r3_draft_finish_plan || r.r3_submission_plan)) return "R3";
  if ((rr1 === "B" || rr1 === "C") && !(r.r2_draft_finish_plan || r.r2_submission_plan)) return "R2";
  return null;
}
export type AbdRoundStage = "Approved" | "R3" | "R2" | "R1" | "Pending";
export function abdStage(r: AbdMyRow): AbdRoundStage {
  if (abdIsApproved(r)) return "Approved";
  if (r.r3_draft_finish_actual || r.r3_submission_actual || r.r3_dar_actual) return "R3";
  if (r.r2_draft_finish_actual || r.r2_submission_actual || r.r2_dar_actual) return "R2";
  if (r.r1_draft_finish_actual || r.r1_submission_actual || r.r1_dar_actual) return "R1";
  return "Pending";
}
function abdCurrentPlan(r: AbdMyRow): string | null {
  const st = abdStage(r);
  if (st === "R3") return r.r3_dar_plan ?? r.r3_submission_plan ?? r.r3_draft_finish_plan ?? null;
  if (st === "R2") return r.r2_dar_plan ?? r.r2_submission_plan ?? r.r2_draft_finish_plan ?? null;
  if (st === "R1" || st === "Pending") return r.r1_dar_plan ?? r.r1_submission_plan ?? r.r1_draft_finish_plan ?? null;
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
  return d >= 1 && d <= days;
}
export function abdCurrentPlanDate(r: AbdMyRow): string | null {
  return abdCurrentPlan(r);
}

export type AbdTodayKind = "Draft" | "Sub" | "Resp";
function abdCurrentPlanKind(r: AbdMyRow): { plan: string | null; kind: AbdTodayKind | null } {
  const st = abdStage(r);
  const pick = (draft: string | null, sub: string | null, resp: string | null): { plan: string | null; kind: AbdTodayKind | null } => {
    if (resp) return { plan: resp, kind: "Resp" };
    if (sub) return { plan: sub, kind: "Sub" };
    if (draft) return { plan: draft, kind: "Draft" };
    return { plan: null, kind: null };
  };
  if (st === "R3") return pick(r.r3_draft_finish_plan, r.r3_submission_plan, r.r3_dar_plan);
  if (st === "R2") return pick(r.r2_draft_finish_plan, r.r2_submission_plan, r.r2_dar_plan);
  return pick(r.r1_draft_finish_plan, r.r1_submission_plan, r.r1_dar_plan);
}
export function abdTodayKind(r: AbdMyRow, today: string): AbdTodayKind | null {
  if (abdIsApproved(r)) return null;
  const { plan, kind } = abdCurrentPlanKind(r);
  if (!plan || !kind) return null;
  return sameDay(plan, today) ? kind : null;
}
export function abdIsToday(r: AbdMyRow, today: string): boolean {
  return abdTodayKind(r, today) != null;
}

export function today(): string {
  return todayInDoha();
}