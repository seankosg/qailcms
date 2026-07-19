import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DISCIPLINES = ["ARCH", "ELEC", "MECH", "DESN", "PRJC"] as const;

const PreflightRowSchema = z.object({
  task_no: z.string(),
  main_task_no: z.string().nullable().optional(),
  level: z.enum(["parent", "child"]),
  task_name: z.string().nullable().optional(),
  plot: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  plan_start: z.string().nullable().optional(),
  plan_end: z.string().nullable().optional(),
  actual_progress: z.number().nullable().optional(),
});

const PreflightInputSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  rows: z.array(PreflightRowSchema).max(20000),
});

export type PreflightConflict = {
  task_no: string;
  reason: string; // "task_name_mismatch" | "parent_mismatch" | "plot_mismatch"
  db: {
    task_name: string | null;
    main_task_no: string | null;
    plot: string | null;
  };
  file: {
    task_name: string | null;
    main_task_no: string | null;
    plot: string | null;
  };
};

export type PreflightSummary = {
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  conflictCount: number;
  conflicts: PreflightConflict[];
};

function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function nameSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Length-based lightweight similarity: containment or ≥60% shorter/longer ratio
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.5) return true;
  // Character overlap ratio
  const setA = new Set(shorter);
  let hit = 0;
  for (const ch of longer) if (setA.has(ch)) hit++;
  return hit / longer.length >= 0.6;
}

/**
 * Task 임포트 실행 전 diff 미리보기:
 * - A. 신규
 * - B. 변경 없음(진척/일정 동일)
 * - C. 갱신
 * - D. 충돌(같은 task_no지만 실제 다른 태스크로 의심)
 */
export const previewTaskImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => PreflightInputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const rows = data.rows;
    if (rows.length === 0) {
      return {
        newCount: 0,
        updateCount: 0,
        unchangedCount: 0,
        conflictCount: 0,
        conflicts: [] as PreflightConflict[],
      } satisfies PreflightSummary;
    }

    const taskNos = rows.map((r) => r.task_no);
    const dbMap = new Map<string, {
      task_no: string;
      main_task_no: string | null;
      task_name: string | null;
      plot: string | null;
      plan_start: string | null;
      plan_end: string | null;
      actual_progress: number | null;
    }>();

    for (let i = 0; i < taskNos.length; i += 500) {
      const chunk = taskNos.slice(i, i + 500);
      const { data: dbRows, error } = await supabase
        .from("task_management_raw")
        .select("task_no, main_task_no, task_name, plot, plan_start, plan_end, actual_progress")
        .eq("discipline", data.discipline)
        .in("task_no", chunk);
      if (error) throw new Error(error.message);
      for (const r of dbRows ?? []) {
        dbMap.set(r.task_no as string, r as any);
      }
    }

    let newCount = 0;
    let updateCount = 0;
    let unchangedCount = 0;
    const conflicts: PreflightConflict[] = [];

    for (const r of rows) {
      const db = dbMap.get(r.task_no);
      if (!db) {
        newCount++;
        continue;
      }

      // Conflict detection
      const parentMismatch =
        (r.main_task_no ?? null) &&
        (db.main_task_no ?? null) &&
        r.main_task_no !== db.main_task_no;
      const plotMismatch =
        !!r.plot && !!db.plot && normalizeName(r.plot) !== normalizeName(db.plot);
      const nameConflict =
        !!r.task_name && !!db.task_name && !nameSimilar(r.task_name, db.task_name);

      if (parentMismatch || plotMismatch || nameConflict) {
        conflicts.push({
          task_no: r.task_no,
          reason: parentMismatch
            ? "parent_mismatch"
            : plotMismatch
              ? "plot_mismatch"
              : "task_name_mismatch",
          db: {
            task_name: db.task_name,
            main_task_no: db.main_task_no,
            plot: db.plot,
          },
          file: {
            task_name: r.task_name ?? null,
            main_task_no: r.main_task_no ?? null,
            plot: r.plot ?? null,
          },
        });
        continue;
      }

      // Unchanged vs Update: compare key managed fields
      const same =
        (r.plan_start ?? null) === (db.plan_start ?? null) &&
        (r.plan_end ?? null) === (db.plan_end ?? null) &&
        Number(r.actual_progress ?? 0) === Number(db.actual_progress ?? 0);
      if (same) unchangedCount++;
      else updateCount++;
    }

    return {
      newCount,
      updateCount,
      unchangedCount,
      conflictCount: conflicts.length,
      conflicts: conflicts.slice(0, 500), // safety cap
    } satisfies PreflightSummary;
  });

/**
 * DB RPC `allocate_task_no` 래퍼 — 자동 재번호 시 사용
 */
const AllocateSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  main_task_no: z.string().nullable().optional(),
});

export const allocateTaskNo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => AllocateSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: next, error } = await (context.supabase as any).rpc("allocate_task_no", {
      _discipline: data.discipline,
      _main_task_no: data.main_task_no ?? null,
    });
    if (error) throw new Error(error.message);
    return { task_no: String(next ?? "") };
  });