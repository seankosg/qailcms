import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInDoha } from "@/lib/time/doha";

export type AbdAttentionKind = "needs_plan" | "revise" | "delayed" | "upcoming";

export interface AbdAttentionRow {
  id: string;
  kind: AbdAttentionKind;
  abd_number: string | null;
  document_title: string | null;
  hdec_pic_name: string | null;
  team: string | null;
  next_round: string | null; // R1/R2/R3
  plan_date: string | null;
  days: number | null; // 지연 D+, 임박 D-
  updated_at: string | null;
}

interface Options {
  isAdmin: boolean;
  scope: "pic" | "team";
  filterValue: string | null;
  userId?: string | null;
}

function daysBetween(a: string | null | undefined, base: string): number | null {
  if (!a) return null;
  const x = new Date(`${String(a).slice(0, 10)}T00:00:00Z`).getTime();
  const y = new Date(`${base.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round((x - y) / 86_400_000);
}

function nextRoundLabel(r: any): string | null {
  const rr1 = String(r.r1_response_result ?? "").toUpperCase();
  const rr2 = String(r.r2_response_result ?? "").toUpperCase();
  if ((rr2 === "B" || rr2 === "C") && !(r.r3_draft_finish_plan || r.r3_submission_plan)) return "R3";
  if ((rr1 === "B" || rr1 === "C") && !(r.r2_draft_finish_plan || r.r2_submission_plan)) return "R2";
  return null;
}

function currentPlan(r: any): string | null {
  const approved = String(r.latest_status ?? "").toUpperCase() === "A";
  if (approved) return null;
  if (r.r3_draft_finish_actual || r.r3_submission_actual || r.r3_dar_actual) {
    return r.r3_dar_plan ?? r.r3_submission_plan ?? r.r3_draft_finish_plan ?? null;
  }
  if (r.r2_draft_finish_actual || r.r2_submission_actual || r.r2_dar_actual) {
    return r.r2_dar_plan ?? r.r2_submission_plan ?? r.r2_draft_finish_plan ?? null;
  }
  return r.r1_dar_plan ?? r.r1_submission_plan ?? r.r1_draft_finish_plan ?? null;
}

export function useAbdAttentionInbox({ isAdmin, scope, filterValue, userId }: Options) {
  const today = todayInDoha();
  return useQuery<AbdAttentionRow[]>({
    queryKey: ["abd-attention-inbox", isAdmin ? "admin" : scope, filterValue ?? "-", today, userId ?? "-"],
    enabled: isAdmin || !!filterValue,
    staleTime: 60_000,
    queryFn: async () => {
      const cols = [
        "id,abd_number,document_title,hdec_pic_name,team,latest_status,updated_at,is_terminated,is_active,needs_planning,needs_revise,revise_source_round",
        "r1_response_result,r2_response_result,r3_response_result",
        "r1_draft_finish_plan,r1_draft_finish_actual,r1_submission_plan,r1_submission_actual,r1_dar_plan,r1_dar_actual",
        "r2_draft_finish_plan,r2_draft_finish_actual,r2_submission_plan,r2_submission_actual,r2_dar_plan,r2_dar_actual",
        "r3_draft_finish_plan,r3_draft_finish_actual,r3_submission_plan,r3_submission_actual,r3_dar_plan,r3_dar_actual",
      ].join(",");

      // PostgREST 응답 상한(1,000행) 우회를 위한 청크 루프.
      // Attention 항목 특성상 실무 상한을 넉넉히 20k로 방어.
      const PAGE = 1000;
      const MAX_ROWS = 20_000;
      const rows: any[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const to = Math.min(from + PAGE, MAX_ROWS) - 1;
        let q = (supabase as any)
          .from("abd_items_raw")
          .select(cols)
          .eq("is_active", true)
          .neq("is_terminated", true)
          .neq("latest_status", "A")
          .order("id", { ascending: true })
          .range(from, to);
        if (!isAdmin) {
          q = q.eq(scope === "team" ? "team" : "hdec_pic_name", filterValue);
        }
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const chunk = (data ?? []) as any[];
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
      }

      const out: AbdAttentionRow[] = [];
      for (const r of rows) {
        const base = {
          id: r.id as string,
          abd_number: r.abd_number ?? null,
          document_title: r.document_title ?? null,
          hdec_pic_name: r.hdec_pic_name ?? null,
          team: r.team ?? null,
          updated_at: r.updated_at ?? null,
        };

        const nr = nextRoundLabel(r);
        const needsPlan = !!r.needs_planning || !!nr;
        if (needsPlan) {
          out.push({ ...base, kind: "needs_plan", next_round: nr, plan_date: null, days: null });
        }

        if (r.needs_revise) {
          const src = r.revise_source_round;
          out.push({
            ...base,
            kind: "revise",
            next_round: src === 1 ? "R2" : src === 2 ? "R3" : null,
            plan_date: null,
            days: null,
          });
        }

        const plan = currentPlan(r);
        if (plan) {
          const d = daysBetween(plan, today);
          if (d != null) {
            if (d < 0) {
              out.push({ ...base, kind: "delayed", next_round: null, plan_date: plan, days: -d });
            } else if (d >= 1 && d <= 3) {
              out.push({ ...base, kind: "upcoming", next_round: null, plan_date: plan, days: d });
            }
          }
        }
      }
      return out;
    },
  });
}