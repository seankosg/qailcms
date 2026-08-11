import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, Loader2, MessageSquare, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatDdMmmYyyy, todayInDoha } from "@/lib/time/doha";
import { AbdEditCellPopover } from "@/components/abd/raw-data/AbdEditCellPopover";
import { useRclCan } from "@/hooks/useRclCan";
import { getSplRowsAsOf, type SplCatalogEntry, type SplRow } from "@/lib/spl/rows.functions";
import { updateSplField } from "@/lib/spl/mutations.functions";
import { SPL_EDITABLE_FIELDS, splJudgmentLabel } from "@/components/spl/raw-data/spl-columns";
import { SplRequiredDocChecklist } from "@/components/spl/raw-data/SplRequiredDocChecklist";
import { listSplDocuments } from "@/lib/spl/documents.functions";
import { SplOcsPanels, type SplPanelKind, type SplPanelTarget } from "@/components/spl/ocs/SplOcsPanels";

interface ChangeLogRow {
  id: string;
  column_name: string | null;
  stage_code: string | null;
  action: string | null;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
  changed_at: string;
}

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

const BANDS: Array<SplCatalogEntry["band"]> = ["DOCUMENTATION", "PO", "REQUIRED_DOC"];

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return formatDdMmmYyyy(v) || "—";
}

function isLate(plan: string | null | undefined, actual: string | null | undefined): boolean {
  if (!plan || !actual) return false;
  return new Date(actual).getTime() > new Date(plan).getTime();
}

/**
 * SPL 상세 본문 — ABD 상세(AbdDetailBody)와 동일한 UI 구성.
 * 값은 SPL 정본(`getSplRowsAsOf`) 경유이며 클라이언트 재계산은 없다.
 */
export function SplDetailBody({ id }: { id: string }) {
  const today = todayInDoha();
  const fetchRows = useServerFn(getSplRowsAsOf);
  const saveField = useServerFn(updateSplField);
  const qc = useQueryClient();
  const { canRow } = useRclCan("SPL", "write");
  const [changes, setChanges] = useState<ChangeLogRow[]>([]);
  const [panelTarget, setPanelTarget] = useState<SplPanelTarget>(null);
  const fetchDocs = useServerFn(listSplDocuments);
  const { data: docs } = useQuery({
    queryKey: ["spl-documents", id],
    queryFn: () => fetchDocs({ data: { splItemId: id } }),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["spl-rows-as-of", today],
    queryFn: () => fetchRows({ data: { as_of: today } }),
  });

  const row: SplRow | null = useMemo(
    () => (data?.rows ?? []).find((r) => r.id === id) ?? null,
    [data, id],
  );
  const catalog: SplCatalogEntry[] = data?.catalog ?? [];

  useEffect(() => {
    let cancel = false;
    const run = async () => {
      const { data: cl } = await (supabase as any)
        .from("spl_change_log")
        .select("id, column_name, stage_code, action, old_value, new_value, source, changed_at")
        .eq("item_id", id)
        .order("changed_at", { ascending: false })
        .limit(20);
      if (!cancel) setChanges((cl ?? []) as ChangeLogRow[]);
    };
    void run();
    return () => {
      cancel = true;
    };
  }, [id]);

  const onFieldSaved = async () => {
    await refetch();
    qc.invalidateQueries({ queryKey: ["spl-rows-as-of"] });
  };

  const canEdit = !!row && canRow(row as unknown as Record<string, unknown>);

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-start justify-between gap-2 text-base font-semibold">
          {row ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{row.spl_number}</span>
              <Badge variant="outline" className="text-[10px]">{row.plot ? `PLOT-${row.plot}` : "Plot —"}</Badge>
              <Badge variant={row.judgment === "지연" ? "destructive" : "secondary"} className="text-[10px]">
                {splJudgmentLabel(row.judgment)}
              </Badge>
              {row.current_stage && (
                <Badge variant="outline" className="text-[10px]">{row.current_stage.label}</Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                Completed: {row.completed_stage?.label ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Progress {row.progress_pct == null ? "—" : `${row.progress_pct}%`} ({row.done}/{row.denom})
              </Badge>
              <Badge variant="outline" className="text-[10px]">Req.Doc {row.req_doc_done}/{row.req_doc_total}</Badge>
            </div>
          ) : (
            "Loading..."
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {([
              { kind: "ocs" as const, icon: MessageSquare, label: "OCS", count: row?.ocs_total ?? 0, pending: row?.ocs_pending ?? 0 },
              { kind: "rsp" as const, icon: Package, label: "RSP", count: row?.rsp_total ?? 0, pending: 0 },
              { kind: "documents" as const, icon: FileText, label: "Documents", count: docs?.length ?? 0, pending: 0 },
            ] satisfies Array<{ kind: SplPanelKind; icon: typeof FileText; label: string; count: number; pending: number }>).map((b) => (
              <Button
                key={b.kind}
                size="sm"
                variant="outline"
                disabled={!row}
                className="h-7 gap-1 text-[11px]"
                onClick={() =>
                  row && setPanelTarget({ id: row.id, splNumber: row.spl_number, kind: b.kind })
                }
              >
                <b.icon className="h-3.5 w-3.5" /> {b.label} {b.count}
                {b.pending > 0 && <span className="text-destructive">({b.pending})</span>}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <SplOcsPanels
        key={panelTarget ? `${panelTarget.id}:${panelTarget.kind}` : "none"}
        target={panelTarget}
        onClose={() => setPanelTarget(null)}
      />

      {isLoading && !row ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : !row ? (
        <div className="py-16 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <div className="mt-4 space-y-6 text-xs">
          {/* Summary */}
          <section className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><span className="text-muted-foreground">Team</span><div className="font-medium uppercase">{row.team ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Plot</span><div className="font-medium">{row.plot ?? "—"}</div></div>
            <div><span className="text-muted-foreground">DIS</span><div className="font-medium">{row.dis ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Service</span><div className="font-medium">{row.service ?? "—"}</div></div>
            <div className="col-span-2"><span className="text-muted-foreground">Title</span><div className="font-medium">{row.title ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Supplier</span><div className="font-medium">{row.supplier ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Latest Status</span><div className="font-medium">{row.latest_status ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Revision</span><div className="font-medium">{row.revision ?? "—"}</div></div>
            <div><span className="text-muted-foreground">Data Date</span><div className="font-medium">{fmtDate(row.data_date)}</div></div>
            <div><span className="text-muted-foreground">Active Round</span><div className="font-medium">{row.active_round}</div></div>
            <div>
              <span className="text-muted-foreground">Primary delay</span>
              <div className={cn("font-medium", row.primary_delay && "text-destructive")}>
                {row.primary_delay ? `${row.primary_delay.label} · ${row.primary_delay.days}d` : "—"}
              </div>
            </div>
          </section>

          <Separator />

          {/* Owners (editable) */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Owners</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-2 md:grid-cols-5">
              {SPL_EDITABLE_FIELDS.map((f) => (
                <div key={f.field}>
                  <div className="text-[10px] uppercase text-muted-foreground">{f.label}</div>
                  <AbdEditCellPopover
                    id={row.id}
                    field={f.field}
                    label={f.label}
                    editorType="text"
                    currentValue={(row as any)[f.field]}
                    canEdit={canEdit}
                    saveFn={async (p) => {
                      await saveField({
                        data: { id: row.id, field: p.field, value: p.value == null ? null : String(p.value) },
                      });
                    }}
                    onSaved={onFieldSaved}
                  >
                    <span className="text-xs">{(row as any)[f.field] ?? "—"}</span>
                  </AbdEditCellPopover>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          {/* Stage Timeline (밴드별) */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Stage Timeline</h3>
            <div className="space-y-3">
              {BANDS.map((band) => {
                const entries = catalog.filter((c) => c.band === band);
                if (entries.length === 0) return null;
                const state = row.band_states?.[band];
                return (
                  <div key={band} className={cn("overflow-hidden rounded-md border", state === "empty" && "opacity-60")}>
                    <div className="flex items-center justify-between bg-muted/50 px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{BAND_LABEL[band] ?? band}</span>
                        {state === "empty" && <Badge variant="outline" className="text-[10px]">미착수</Badge>}
                        {state === "complete" && <Badge variant="secondary" className="text-[10px]">완료</Badge>}
                      </div>
                      {row.active_band === band && (
                        <Badge variant="outline" className="text-[10px]">Active band</Badge>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead className="border-t bg-background">
                        <tr>
                          <th className="w-56 px-2 py-1 text-left">Stage</th>
                          <th className="px-2 py-1 text-left">Plan Start</th>
                          <th className="px-2 py-1 text-left">Actual Start</th>
                          <th className="px-2 py-1 text-left">Plan Finish</th>
                          <th className="px-2 py-1 text-left">Actual Finish</th>
                          <th className="px-2 py-1 text-left">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((s) => {
                          const c = row.stages[s.stage_code];
                          const lateS = isLate(c?.ps, c?.as);
                          const lateF = isLate(c?.pf, c?.af);
                          return (
                            <tr key={s.stage_code} className={cn("border-t", c?.na && "bg-muted/40")}>
                              <td className="px-2 py-1">
                                {s.label}
                                {s.actual_authority === "ACONEX" && (
                                  <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] text-emerald-800">Aconex</span>
                                )}
                              </td>
                              <td className={cn("px-2 py-1", !c?.ps && "text-muted-foreground")}>{fmtDate(c?.ps)}</td>
                              <td className={cn("px-2 py-1", c?.as ? "font-medium" : "text-muted-foreground", lateS && "text-destructive")}>
                                {fmtDate(c?.as)}{lateS && " ⚠"}
                              </td>
                              <td className={cn("px-2 py-1", !c?.pf && "text-muted-foreground")}>{fmtDate(c?.pf)}</td>
                              <td className={cn("px-2 py-1", c?.af ? "font-medium" : "text-muted-foreground", lateF && "text-destructive")}>
                                {fmtDate(c?.af)}{lateF && " ⚠"}
                              </td>
                              <td className="px-2 py-1">{c?.na ? "NA" : (c?.fv ?? "—")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Required Documents */}
          <SplRequiredDocChecklist
            row={row}
            catalog={catalog}
            canEdit={canEdit}
            onChanged={onFieldSaved}
          />

          {/* Change Log */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Change Log</h3>
            {changes.length === 0 ? (
              <p className="text-muted-foreground">변경 이력이 없습니다.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">When</th>
                      <th className="px-2 py-1.5 text-left">Field</th>
                      <th className="px-2 py-1.5 text-left">Old</th>
                      <th className="px-2 py-1.5 text-left">New</th>
                      <th className="px-2 py-1.5 text-left">Src</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                          {new Date(c.changed_at).toLocaleString("ko-KR", { hour12: false })}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {c.stage_code ? `${c.stage_code}.${c.column_name ?? c.action ?? ""}` : (c.column_name ?? c.action ?? "—")}
                        </td>
                        <td className="px-2 py-1">{c.old_value ?? "—"}</td>
                        <td className="px-2 py-1 font-medium">{c.new_value ?? "—"}</td>
                        <td className="px-2 py-1">
                          <Badge variant="outline" className="text-[10px]">{c.source ?? "—"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Raw Payload */}
          <section>
            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-semibold">Raw Payload</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-2 text-[11px]">
                {JSON.stringify(row, null, 2)}
              </pre>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}