import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";

/**
 * 설비 T&C 잔여 파일 임포트 (`Plot-D_Remaining Works Status` 시트).
 *
 * 확정된 규칙
 *  - 매칭은 대응표(`toc_mech_system_map`) 뿐이다. 없으면 "미연결"로 남기고 추측하지 않는다.
 *  - Status=Closed → T&C 완료(단계 상태만). Open → 수량 기준 가장 낮은 단계, Code-C 수량이 있으면 반려.
 *  - 한 항목에 여러 파일 행이 걸리면 가장 낮은 단계 · 가장 늦은 목표일을 채택한다.
 *  - 종료목표일 = TARGET DATE. 공란이면 기존 계획일을 유지한다(임의 생성 금지).
 *  - 파일(잔여 목록)에 없는 설비 항목 = T&C 완료. 날짜는 만들지 않고 상태만 기록한다.
 *  - 권한 근거는 `rcl_grants('TOC','import')` 뿐이며 행 스코프는 서버에서 다시 판정한다.
 */

const RowSchema = z.object({
  sheet_name: z.string(),
  excel_row: z.number(),
  source_system: z.string(),
  source_description: z.string(),
  status_raw: z.string().nullable(),
  is_closed: z.boolean(),
  toc_status: z.string().nullable(),
  target_finish: z.string().nullable(),
});

const InputSchema = z.object({
  file_name: z.string(),
  sheet_name: z.string(),
  plot: z.enum(["C", "D"]).default("D"),
  rows: z.array(RowSchema).max(5000),
  apply: z.boolean().default(false),
  /** 미연결 조합이 있어도 진행한다는 명시적 승인 (로그에 남는다) */
  accept_unlinked: z.boolean().default(false),
  scope_note: z.string().optional(),
});

export type MechChange = { target: string; field: string; previous: string | null; next: string | null };

export type MechRowDiff = {
  source: string;
  excel_row: number;
  item_key: string | null;
  outcome: "updated" | "unchanged" | "unlinked";
  status_raw: string | null;
  changes: MechChange[];
};

export type MechTcResult = {
  total: number;
  linked: number;
  unlinked: number;
  unlinked_list: Array<{ source: string; excel_row: number; status_raw: string | null }>;
  status_changed: number;
  plan_changed: number;
  tac_completed: number;
  /** 파일에 없어 T&C 완료로 바뀌는 항목 */
  completed_by_absence: number;
  completed_list: string[];
  diff_rows: MechRowDiff[];
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
  rejected: Array<{ key: string; reason_code: string; message: string }>;
  identity: { parsed: number; applied_rows: number; unchanged: number; unlinked: number; rejected: number; unclassified: number };
  status: "success" | "partial" | "failed" | "preview";
};

const TAC = "TAC_COMPLETION";
const DONE_CODE = "Completed";
const RANK: Record<string, number> = { "Not Submitted": 0, "UR IFM": 1, "Code B": 2, "Code A": 3 };

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export const importTocMechTc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<MechTcResult> => {
    const supa = context.supabase as any;
    const { data: grants, error: gErr } = await supa.rpc("rcl_grants", { _module: "TOC", _action: "import" });
    if (gErr) throw new Error(`권한 조회 실패: ${gErr.message}`);
    const g = grants as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
    if (!g?.role || !(g.own || g.own_team || g.other_team)) {
      throw new Error("권한 없음: 인계(TOC) 임포트 권한이 없습니다");
    }

    const [{ data: mapRows, error: mErr }, { data: items, error: iErr }] = await Promise.all([
      supa
        .from("toc_mech_system_map")
        .select("source_system, source_description, item_key, is_active")
        .eq("plot", data.plot)
        .eq("is_active", true),
      supa
        .from("toc_items")
        .select("id, item_key, team, pic, eng, toc_status")
        .eq("team", "MECH")
        .eq("plot", data.plot)
        .eq("is_active", true),
    ]);
    if (mErr) throw new Error(`대응표 조회 실패: ${mErr.message}`);
    if (iErr) throw new Error(`항목 조회 실패: ${iErr.message}`);

    const mapKey = (a: string, b: string) => `${a}|${b}`.toLowerCase();
    const linkMap = new Map<string, string>();
    for (const m of mapRows ?? []) {
      if (!m.item_key) continue;
      linkMap.set(mapKey(m.source_system ?? "", m.source_description ?? ""), m.item_key);
    }
    const byKey = new Map<string, any>((items ?? []).map((i: any) => [i.item_key, i]));

    const ids = (items ?? []).map((i: any) => i.id);
    const { data: prog, error: pErr } = await supa
      .from("toc_stage_progress")
      .select("item_id, stage_code, plan_finish, code_value")
      .eq("stage_code", TAC)
      .in("item_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (pErr) throw new Error(`단계 조회 실패: ${pErr.message}`);
    const tacByItem = new Map<string, any>((prog ?? []).map((p: any) => [p.item_id, p]));

    // ── 파일 행 → 항목별 병합
    const merged = new Map<
      string,
      { status: string | null; finish: string | null; raws: string[]; rows: number; closedRows: number }
    >();
    const diffs: MechRowDiff[] = [];
    const unlinkedList: MechTcResult["unlinked_list"] = [];

    for (const r of data.rows) {
      const src = [r.source_system, r.source_description].filter(Boolean).join(" / ");
      const key = linkMap.get(mapKey(r.source_system, r.source_description));
      if (!key || !byKey.has(key)) {
        unlinkedList.push({ source: src, excel_row: r.excel_row, status_raw: r.status_raw });
        diffs.push({ source: src, excel_row: r.excel_row, item_key: key ?? null, outcome: "unlinked", status_raw: r.status_raw, changes: [] });
        continue;
      }
      const cur = merged.get(key) ?? { status: null, finish: null, raws: [], rows: 0, closedRows: 0 };
      cur.rows += 1;
      if (r.is_closed) cur.closedRows += 1;
      cur.raws.push(`${src}${r.status_raw ? ` (${r.status_raw})` : ""}`);
      if (r.toc_status) {
        if (cur.status === null) cur.status = r.toc_status;
        else if (cur.status !== "Code C" && r.toc_status === "Code C") cur.status = "Code C";
        else if (cur.status !== "Code C" && (RANK[r.toc_status] ?? 0) < (RANK[cur.status] ?? 0)) cur.status = r.toc_status;
      }
      if (r.target_finish && (cur.finish === null || r.target_finish > cur.finish)) cur.finish = r.target_finish;
      merged.set(key, cur);
    }

    const gateRows = Array.from(merged.keys()).map((k) => {
      const it = byKey.get(k);
      return {
        key: k,
        item: { team: s(it?.team), pic: s(it?.pic), eng: s(it?.eng) } as Record<string, string | null>,
      };
    });
    await assertImportScope(supa, "TOC", "item_key", ["team", "pic", "eng"], gateRows, (r) => r.key, null);

    const patches: any[] = [];
    let statusChanged = 0;
    let planChanged = 0;
    let tacCompleted = 0;

    for (const [key, m] of merged) {
      const it = byKey.get(key);
      const tac = tacByItem.get(it.id) ?? {};
      const changes: MechChange[] = [];
      const itemPatch: Record<string, string | null> = {};
      const stagePatch: Record<string, string | null> = {};
      const allClosed = m.rows > 0 && m.closedRows === m.rows;

      if (m.status && m.status !== s(it.toc_status)) {
        itemPatch["toc_status"] = m.status;
        changes.push({ target: "item", field: "toc_status", previous: s(it.toc_status), next: m.status });
        statusChanged += 1;
      }
      if (m.finish && m.finish !== s(tac.plan_finish)) {
        stagePatch["plan_finish"] = m.finish;
        changes.push({ target: TAC, field: "plan_finish", previous: s(tac.plan_finish), next: m.finish });
        planChanged += 1;
      }
      if (allClosed && s(tac.code_value) !== DONE_CODE) {
        stagePatch["code_value"] = DONE_CODE;
        changes.push({ target: TAC, field: "code_value", previous: s(tac.code_value), next: DONE_CODE });
        tacCompleted += 1;
      }

      diffs.push({
        source: m.raws.join(" | "),
        excel_row: 0,
        item_key: key,
        outcome: changes.length > 0 ? "updated" : "unchanged",
        status_raw: m.raws.join(" | ") || null,
        changes,
      });
      if (changes.length > 0) {
        patches.push({
          item_key: key,
          item: itemPatch,
          stages: Object.keys(stagePatch).length > 0 ? [{ stage_code: TAC, ...stagePatch }] : [],
        });
      }
    }

    // ── 파일(잔여 목록)에 없는 설비 항목 = T&C 완료 (날짜는 만들지 않고 상태만)
    const completedList: string[] = [];
    for (const it of items ?? []) {
      if (merged.has(it.item_key)) continue;
      const tac = tacByItem.get(it.id) ?? {};
      if (s(tac.code_value) === DONE_CODE) continue;
      completedList.push(it.item_key);
      patches.push({ item_key: it.item_key, item: {}, stages: [{ stage_code: TAC, code_value: DONE_CODE }] });
      diffs.push({
        source: "(파일에 없음 → T&C 완료)",
        excel_row: 0,
        item_key: it.item_key,
        outcome: "updated",
        status_raw: null,
        changes: [{ target: TAC, field: "code_value", previous: s(tac.code_value), next: DONE_CODE }],
      });
    }

    const base: Omit<MechTcResult, "applied" | "batch_id" | "items_updated" | "stages_upserted" | "rejected" | "identity" | "status"> = {
      total: data.rows.length,
      linked: data.rows.length - unlinkedList.length,
      unlinked: unlinkedList.length,
      unlinked_list: unlinkedList.slice(0, 200),
      status_changed: statusChanged,
      plan_changed: planChanged,
      tac_completed: tacCompleted,
      completed_by_absence: completedList.length,
      completed_list: completedList.slice(0, 200),
      diff_rows: diffs.filter((d) => d.outcome !== "unchanged").slice(0, 300),
    };
    const unchangedRows = diffs.filter((d) => d.outcome === "unchanged").length;
    const changedRows = diffs.filter((d) => d.outcome === "updated").length;

    if (!data.apply) {
      return {
        ...base,
        applied: false,
        batch_id: null,
        items_updated: 0,
        stages_upserted: 0,
        rejected: [],
        identity: {
          parsed: data.rows.length,
          applied_rows: 0,
          unchanged: unchangedRows,
          unlinked: unlinkedList.length,
          rejected: 0,
          unclassified: 0,
        },
        status: "preview",
      };
    }
    if (unlinkedList.length > 0 && !data.accept_unlinked) {
      throw new Error(`미연결 ${unlinkedList.length}건이 있습니다. "이 항목들 없이 진행"을 승인한 뒤 다시 실행하세요.`);
    }

    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("toc_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: [data.sheet_name],
        total_rows: data.rows.length,
        matched: base.linked,
        unmatched: unlinkedList.length,
        status: "success",
        started_at: nowIso,
        imported_by: context.userId,
      })
      .select("id")
      .single();
    if (logErr) throw new Error(logErr.message);
    const batchId = logRow.id as string;

    let itemsUpdated = 0;
    let stagesUpserted = 0;
    const rejected: MechTcResult["rejected"] = [];
    try {
      const CHUNK = 200;
      for (let i = 0; i < patches.length; i += CHUNK) {
        const { data: res, error } = await supa.rpc("toc_hdec_apply", {
          _batch_id: batchId,
          _patches: patches.slice(i, i + CHUNK),
          _allow_deletes: false, // 이 경로는 값을 지우지 않는다
          _delete_count: 0,
        });
        if (error) throw new Error(error.message);
        itemsUpdated += Number(res?.items_updated ?? 0);
        stagesUpserted += Number(res?.stages_upserted ?? 0);
        for (const r of (res?.rejected ?? []) as any[]) {
          rejected.push({
            key: String(r?.key ?? ""),
            reason_code: String(r?.reason_code ?? ""),
            message: String(r?.message ?? ""),
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await supa
        .from("toc_import_logs")
        .update({ status: "failed", note: `TOC MECH T&C import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    const rejectedKeys = new Set(rejected.map((r) => r.key));
    const appliedRows = diffs.filter((d) => d.outcome === "updated" && !rejectedKeys.has(d.item_key ?? "")).length;
    const unclassified = diffs.length - (appliedRows + unchangedRows + unlinkedList.length + rejectedKeys.size);
    const status: "success" | "partial" | "failed" =
      unlinkedList.length === 0 && rejected.length === 0 && appliedRows === changedRows
        ? "success"
        : appliedRows === 0 && changedRows > 0
          ? "failed"
          : "partial";

    const rowLogs = diffs.map((d) => ({
      batch_id: batchId,
      sheet_name: data.sheet_name,
      excel_row: d.excel_row || null,
      item_key: d.item_key,
      outcome: rejectedKeys.has(d.item_key ?? "") ? "rejected" : d.outcome,
      code:
        d.outcome === "unlinked"
          ? "unlinked"
          : rejectedKeys.has(d.item_key ?? "")
            ? "rejected"
            : d.outcome === "updated"
              ? "applied"
              : "unchanged",
      detail: `${d.source}${d.status_raw ? ` · status="${d.status_raw}"` : ""}`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("toc_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[toc mech row logs]", error.message);
    }

    await supa
      .from("toc_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        status,
        finished_at: new Date().toISOString(),
        note: `[MECH T&C] rows=${data.rows.length} linked=${base.linked} unlinked=${unlinkedList.length} status_changed=${statusChanged} plan_changed=${planChanged} tac_completed=${tacCompleted} completed_by_absence=${completedList.length} rejected=${rejected.length} unchanged=${unchangedRows} unclassified=${unclassified}${
          data.accept_unlinked ? " accepted_unlinked=yes" : ""
        }${data.scope_note ? ` ${data.scope_note}` : ""}`,
      })
      .eq("id", batchId);

    return {
      ...base,
      applied: true,
      batch_id: batchId,
      items_updated: itemsUpdated,
      stages_upserted: stagesUpserted,
      rejected,
      identity: {
        parsed: data.rows.length,
        applied_rows: appliedRows,
        unchanged: unchangedRows,
        unlinked: unlinkedList.length,
        rejected: rejected.length,
        unclassified,
      },
      status,
    };
  });
