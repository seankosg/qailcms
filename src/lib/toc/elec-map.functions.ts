import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 전기 T&C 대응표 조회·저장.
 * - 대응표가 유일한 매칭 근거다. 표에 없는 조합은 추측하지 않고 "미연결"로 남긴다.
 * - 쓰기 권한 근거는 `rcl_grants('TOC','import')` 뿐이다.
 */

export interface TocElecMapRow {
  id: string;
  plot: string;
  source_system: string;
  source_sub: string;
  source_description: string;
  item_key: string | null;
  is_active: boolean;
  note: string | null;
}

export interface TocElecMapItem {
  item_key: string;
  main_system: string | null;
  sub_system: string | null;
  toc_status: string | null;
}

export const getTocElecMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ map: TocElecMapRow[]; items: TocElecMapItem[]; can_write: boolean }> => {
    const supa = context.supabase as any;
    const [{ data: map, error: e1 }, { data: items, error: e2 }, { data: grants }] = await Promise.all([
      supa
        .from("toc_elec_system_map")
        .select("id, plot, source_system, source_sub, source_description, item_key, is_active, note")
        .order("source_system")
        .order("source_sub")
        .order("source_description"),
      supa
        .from("toc_items")
        .select("item_key, main_system, sub_system, toc_status")
        .eq("team", "ELEC")
        .eq("is_active", true)
        .order("main_system")
        .order("sub_system"),
      supa.rpc("rcl_grants", { _module: "TOC", _action: "import" }),
    ]);
    if (e1) throw new Error(`대응표 조회 실패: ${e1.message}`);
    if (e2) throw new Error(`항목 조회 실패: ${e2.message}`);
    const g = grants as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
    return {
      map: (map ?? []) as TocElecMapRow[],
      items: (items ?? []) as TocElecMapItem[],
      can_write: Boolean(g?.role && (g.own || g.own_team || g.other_team)),
    };
  });

const UpsertSchema = z.object({
  rows: z
    .array(
      z.object({
        plot: z.enum(["C", "D"]).default("D"),
        source_system: z.string().default(""),
        source_sub: z.string().default(""),
        source_description: z.string().default(""),
        item_key: z.string().nullable(),
        is_active: z.boolean().default(true),
        note: z.string().nullable().default(null),
      }),
    )
    .max(2000),
});

export const saveTocElecMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => UpsertSchema.parse(v))
  .handler(async ({ data, context }): Promise<{ saved: number; cleared: number }> => {
    const supa = context.supabase as any;
    const { data: grants } = await supa.rpc("rcl_grants", { _module: "TOC", _action: "import" });
    const g = grants as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
    if (!g?.role || !(g.own || g.own_team || g.other_team)) {
      throw new Error("권한 없음: 인계(TOC) 임포트 권한이 필요합니다");
    }

    const toClear = data.rows.filter((r) => r.item_key == null);
    const toSave = data.rows.filter((r) => r.item_key != null);

    for (const r of toClear) {
      const { error } = await supa
        .from("toc_elec_system_map")
        .delete()
        .eq("plot", r.plot)
        .eq("source_system", r.source_system)
        .eq("source_sub", r.source_sub)
        .eq("source_description", r.source_description);
      if (error) throw new Error(`대응 삭제 실패: ${error.message}`);
    }
    if (toSave.length > 0) {
      const { error } = await supa
        .from("toc_elec_system_map")
        .upsert(toSave, { onConflict: "plot,source_system,source_sub,source_description" });
      if (error) throw new Error(`대응표 저장 실패: ${error.message}`);
    }
    return { saved: toSave.length, cleared: toClear.length };
  });
