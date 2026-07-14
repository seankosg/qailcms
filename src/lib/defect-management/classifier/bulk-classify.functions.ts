import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyByRules } from "./rule-classify";
import { computeTargets, mergeClassification } from "./apply-classification";
import { CLASSIFIER_FIELDS, type ClassifierField } from "./rules";

const InputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

async function assertEditor(ctx: any) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superuser" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 재분류를 실행할 수 있습니다");
}

/**
 * 지정한 defect 행들에 대해 4개 필드 중 "빈 값(또는 To Be Confirmed)" 필드만
 * 규칙+LLM 하이브리드로 분류하여 UPDATE. 이미 값이 있는 필드는 절대 덮어쓰지 않는다.
 */
export const bulkClassifyDefects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertEditor(context);

    // 필요한 최소 컬럼만 조회
    const rows: Array<{
      id: string;
      source_issue_no: string;
      category: string | null;
      defect_type: string | null;
      item: string | null;
      description: string | null;
      defect_location: string | null;
      main_trade: string | null;
      sub_trade: string | null;
      work_type: string | null;
    }> = [];
    const CHUNK = 500;
    for (let i = 0; i < data.ids.length; i += CHUNK) {
      const chunk = data.ids.slice(i, i + CHUNK);
      const { data: batch, error } = await (context.supabase as any)
        .from("defect_items_raw")
        .select("id, source_issue_no, category, defect_type, item, description, defect_location, main_trade, sub_trade, work_type")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      rows.push(...(batch ?? []));
    }

    // 각 행별 targets 계산 + 규칙 분류
    interface Job {
      id: string;
      source_issue_no: string;
      category: string | null;
      type: string | null;
      item: string | null;
      description: string | null;
      targets: ClassifierField[];
      ruleResult: Partial<Record<ClassifierField, string>>;
    }
    const jobs: Job[] = [];
    for (const r of rows) {
      const targets = computeTargets(
        { defect_location: null, main_trade: null, sub_trade: null, work_type: null },
        {
          defect_location: r.defect_location,
          main_trade: r.main_trade,
          sub_trade: r.sub_trade,
          work_type: r.work_type,
        },
      );
      if (targets.length === 0) continue;
      const ruleResult = classifyByRules(
        { source_issue_no: r.source_issue_no, category: r.category, type: r.defect_type, item: r.item, description: r.description },
        targets,
      );
      jobs.push({
        id: r.id,
        source_issue_no: r.source_issue_no,
        category: r.category,
        type: r.defect_type,
        item: r.item,
        description: r.description,
        targets,
        ruleResult,
      });
    }

    // 규칙으로 못 채운 필드가 있는 항목은 LLM 배치
    const needsLlm = jobs.filter((j) => j.targets.some((t) => !j.ruleResult[t]));
    const llmMap = new Map<string, Record<string, string | null>>();
    if (needsLlm.length > 0) {
      const { classifyDefectsWithLlm } = await import("./llm-classify.functions");
      const LLM_BATCH = 50;
      const batches: typeof needsLlm[] = [];
      for (let i = 0; i < needsLlm.length; i += LLM_BATCH) batches.push(needsLlm.slice(i, i + LLM_BATCH));
      // 병렬 3
      const CONC = 3;
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONC, batches.length) }, async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= batches.length) return;
            const batch = batches[idx];
            try {
              const res = await classifyDefectsWithLlm({
                data: {
                  items: batch.map((b) => ({
                    source_issue_no: b.source_issue_no,
                    category: b.category,
                    type: b.type,
                    item: b.item,
                    description: b.description,
                    targets: b.targets.filter((t) => !b.ruleResult[t]),
                  })),
                },
              });
              for (const r of res.items) {
                llmMap.set(r.source_issue_no, {
                  defect_location: r.defect_location,
                  main_trade: r.main_trade,
                  sub_trade: r.sub_trade,
                  work_type: r.work_type,
                });
              }
            } catch (err) {
              console.warn("[bulk-classify] llm batch failed", err);
            }
          }
        }),
      );
    }

    // 병합 → UPDATE (필드별 카운트)
    const filled: Record<ClassifierField, number> = {
      defect_location: 0,
      main_trade: 0,
      sub_trade: 0,
      work_type: 0,
    };
    let updatedRows = 0;
    let failed = 0;
    const nowIso = new Date().toISOString();

    // 개별 update (배치 update는 컬럼별 다른 값 필요하여 not applicable). 병렬 8.
    const UPD_CONC = 8;
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(UPD_CONC, jobs.length) }, async () => {
        while (true) {
          const j = jobs[idx++];
          if (!j) return;
          const merged = mergeClassification({
            input: { source_issue_no: j.source_issue_no, category: j.category, type: j.type, item: j.item, description: j.description },
            targets: j.targets,
            ruleResult: j.ruleResult,
            llmResult: (llmMap.get(j.source_issue_no) as any) ?? undefined,
          });
          const patch: Record<string, unknown> = { updated_at: nowIso };
          for (const f of j.targets) {
            const v = merged[f];
            if (v == null) continue;
            patch[f] = v;
            filled[f]++;
          }
          if (Object.keys(patch).length <= 1) continue; // updated_at 만 있으면 스킵
          const { error } = await (context.supabase as any)
            .from("defect_items_raw")
            .update(patch)
            .eq("id", j.id);
          if (error) {
            failed++;
            console.warn("[bulk-classify] update failed", j.id, error.message);
          } else {
            updatedRows++;
          }
        }
      }),
    );

    return {
      ok: true,
      considered: rows.length,
      classified: jobs.length,
      updated: updatedRows,
      failed,
      filled,
    };
  });