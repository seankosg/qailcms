import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommentsThread, ABD_CATEGORIES } from "@/components/shared/CommentsThread";
import { formatDdMmmYyyy } from "@/lib/time/doha";
import { AbdEditCellPopover } from "./AbdEditCellPopover";
import { isDfActualBlocked, OCS_DF_BLOCK_MESSAGE } from "@/lib/abd/ocs-df-guard";
import { isDsActualBlocked, MF_DS_BLOCK_MESSAGE } from "@/lib/abd/mf-ds-guard";
import { AbdMfCard } from "@/components/abd/gates/AbdMfCard";
import { AbdAuditCard } from "@/components/abd/gates/AbdAuditCard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRclCan } from "@/hooks/useRclCan";
import { agingTone, AGING_TONE_CLASS, useAbdSettingsQuery } from "@/components/abd/dashboard/AbdAgingSettingsPopover";
import { formatAbdStage } from "@/lib/abd/columns";
import { AbdOcsCommentsButton } from "@/components/abd/ocs/AbdOcsCommentsButton";

interface AbdItemRow {
  id: string;
  team: string;
  plot: string | null;
  sl_no: number | null;
  abd_number: string;
  abd_ocs_no: string | null;
  document_title: string | null;
  pic: string | null;
  latest_rev: string | null;
  latest_status: string | null;
  approval_date: string | null;
  is_active: boolean;
  raw_payload: Record<string, any> | null;
  [k: string]: any;
}

interface ChangeLogRow {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  changed_at: string;
  changed_by: string | null;
}

type StageKey = "draft_start" | "draft_finish" | "submission" | "dar";
const STAGE_LABELS: Record<StageKey, string> = {
  draft_start: "Draft Start (DS)",
  draft_finish: "Draft Finish (DF)",
  submission: "Submission",
  dar: "DAR / Response",
};
const STAGES: StageKey[] = ["draft_start", "draft_finish", "submission", "dar"];

function stageFields(round: 1 | 2 | 3, stage: StageKey): { plan: string; actual: string } {
  return { plan: `r${round}_${stage}_plan`, actual: `r${round}_${stage}_actual` };
}

function resultField(round: 1 | 2 | 3): string {
  return `r${round}_response_result`;
}

const RESULT_TONE: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  B: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  C: "bg-rose-500/15 text-rose-700 border-rose-500/30",
};

function normalizeResult(v: any): "A" | "B" | "C" | null {
  const s = (v ?? "").toString().trim().toUpperCase();
  return s === "A" || s === "B" || s === "C" ? s : null;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return formatDdMmmYyyy(v) || "—";
}

function isLate(plan: string | null, actual: string | null): boolean {
  if (!plan || !actual) return false;
  return new Date(actual).getTime() > new Date(plan).getTime();
}

/**
 * Body-only detail view (no Sheet/Dialog wrapper). Used by the full-page
 * TM-style detail route. Renders nothing when id is null.
 */
export function AbdDetailBody({ id, focusSection }: { id: string | null; focusSection?: "rounds" | "aconex" | "comments" | null }) {
  const [item, setItem] = useState<AbdItemRow | null>(null);
  const [changes, setChanges] = useState<ChangeLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  // 판정 정본: 서버 RCL
  const { canRow: canAbdRow } = useRclCan("ABD", "write");
  const { data: settings } = useAbdSettingsQuery();
  const roundsRef = useRef<HTMLElement>(null);
  const aconexRef = useRef<HTMLElement>(null);
  const commentsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!id || !focusSection || !item) return;
    const target = focusSection === "rounds" ? roundsRef.current
      : focusSection === "aconex" ? aconexRef.current
      : focusSection === "comments" ? commentsRef.current
      : null;
    if (target) {
      const t = window.setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("ring-2", "ring-primary/60", "rounded-md");
        window.setTimeout(() => target.classList.remove("ring-2", "ring-primary/60", "rounded-md"), 1600);
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [id, focusSection, item]);

  useEffect(() => {
    if (!id) { setItem(null); setChanges([]); return; }
    let cancel = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data: it } = await (supabase as any).from("abd_items_raw").select("*").eq("id", id).maybeSingle();
        if (cancel) return;
        setItem(it as any);
        const { data: cl } = await (supabase as any)
          .from("abd_change_log")
          .select("id, field, old_value, new_value, source, changed_at, changed_by")
          .eq("abd_item_id", id)
          .order("changed_at", { ascending: false })
          .limit(20);
        if (cancel) return;
        setChanges((cl ?? []) as any);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    void run();
    return () => { cancel = true; };
  }, [id]);

  const reloadItem = async () => {
    if (!id) return;
    const { data: it } = await (supabase as any).from("abd_items_raw").select("*").eq("id", id).maybeSingle();
    setItem(it as any);
  };

  // 상세창 편집 후: 상세창 로컬 갱신 + Raw Data 목록/대시보드 캐시 무효화
  const onFieldSaved = () => {
    void reloadItem();
    qc.invalidateQueries({ queryKey: ["abd"] });
  };

  const canEdit = !!item && canAbdRow(item as unknown as Record<string, unknown>);
  const aging = item?.ur_aging_days as number | null | undefined;
  const tone = agingTone(aging ?? null, settings);

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-start justify-between gap-2 text-base font-semibold">
            {item ? (
              <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{item.abd_number}</span>
                {!item.is_active && <Badge variant="secondary">Inactive</Badge>}
                {item.current_stage && (
                  <Badge variant="outline" className="text-[10px]">{formatAbdStage(item.current_stage, "long")}</Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  Completed: {formatAbdStage(item.completed_stage as string | null, "completed-long")}
                </Badge>
                {typeof aging === "number" && aging > 0 && (
                  <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", AGING_TONE_CLASS[tone])}>
                    RS {aging}d
                  </span>
                )}
              </div>
              <AbdOcsCommentsButton itemId={item.id} abdNumber={item.abd_number} />
              </>
            ) : "Loading..."}
        </div>
      </div>

        {loading && !item ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...
          </div>
        ) : !item ? (
          <div className="py-16 text-center text-muted-foreground text-sm">데이터가 없습니다.</div>
        ) : (() => {
          const alerts: string[] = [];
          if (item.rs_result_missing) alerts.push("Response 결과 코드(A/B/C)가 누락되었습니다.");
          ([1, 2] as const).forEach((r) => {
            const res = normalizeResult((item as any)[resultField(r)]);
            if (res === "B" || res === "C") {
              const nextR = (r + 1) as 2 | 3;
              const nextDS = (item as any)[stageFields(nextR, "draft_start").plan];
              if (!nextDS) alerts.push(`R${r} 결과 ${res} → R${nextR} 계획(DS/DF/Sub/DAR)이 필요합니다.`);
            }
          });
          return (
          <div className="mt-4 space-y-6 text-xs">
            {/* Summary */}
            <section className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><span className="text-muted-foreground">Team</span><div className="font-medium uppercase">{item.team}</div></div>
              <div><span className="text-muted-foreground">Plot</span><div className="font-medium">{item.plot ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Sl.No</span><div className="font-medium">{item.sl_no ?? "—"}</div></div>
              <div><span className="text-muted-foreground">OCS No</span><div className="font-medium">{item.abd_ocs_no ?? "—"}</div></div>
              <div className="col-span-2"><span className="text-muted-foreground">Document Title</span><div className="font-medium">{item.document_title ?? "—"}</div></div>
              <div><span className="text-muted-foreground">HDEC PIC</span><div className="font-medium">{item.hdec_pic_name ?? "—"}</div></div>
              <div><span className="text-muted-foreground">HDEC ENG</span><div className="font-medium">{item.hdec_eng_name ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Latest Rev</span><div className="font-medium">{item.latest_rev ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Latest Status</span><div className="font-medium">{item.latest_status ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Approval Date</span><div className="font-medium">{fmtDate(item.approval_date)}</div></div>
            </section>

            {alerts.length > 0 && (
              <section className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </section>
            )}

            <Separator />

            {/* Rounds Timeline */}
            <AbdMfCard item={item as any} canEdit={canEdit} onSaved={onFieldSaved} />

            <Separator />

            <section ref={roundsRef} data-section="rounds" className="scroll-mt-4">
              <h3 className="font-semibold text-sm mb-2">Rounds Timeline</h3>
              <div className="space-y-3">
                {([1, 2, 3] as const).map((r) => {
                  const result = normalizeResult((item as any)[resultField(r)]);
                  const hasAnyData = STAGES.some((s) => {
                    const f = stageFields(r, s);
                    return (item as any)[f.plan] || (item as any)[f.actual];
                  }) || !!result;
                  const prevResult = r > 1 ? normalizeResult((item as any)[resultField((r - 1) as 1 | 2)]) : "B"; // R1 항상 활성
                  const activated = r === 1 || prevResult === "B" || prevResult === "C" || hasAnyData;
                  return (
                    <div key={r} className={cn(
                      "rounded-md border overflow-hidden",
                      !activated && "opacity-60",
                    )}>
                      <div className="flex items-center justify-between bg-muted/50 px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Round {r}</span>
                          {!activated && <Badge variant="outline" className="text-[10px]">비활성</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">Response Result</span>
                          {canEdit ? (
                            <AbdEditCellPopover
                              id={item.id}
                              field={resultField(r)}
                              label={`R${r} Response Result`}
                              editorType="select"
                              options={["A", "B", "C"]}
                              currentValue={result}
                              onSaved={onFieldSaved}
                            >
                              {result ? (
                                <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold", RESULT_TONE[result])}>{result}</span>
                              ) : (
                                <span className="text-muted-foreground text-[10px]">—</span>
                              )}
                            </AbdEditCellPopover>
                          ) : result ? (
                            <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold", RESULT_TONE[result])}>{result}</span>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          )}
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="bg-background border-t">
                          <tr>
                            <th className="text-left px-2 py-1 w-40">Stage</th>
                            <th className="text-left px-2 py-1">Plan</th>
                            <th className="text-left px-2 py-1">Actual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {STAGES.map((s) => {
                            const f = stageFields(r, s);
                            const plan = (item as any)[f.plan] as string | null;
                            const actual = (item as any)[f.actual] as string | null;
                            const late = isLate(plan, actual);
                            const planCell = (
                              <span className={cn(!plan && "text-muted-foreground")}>{fmtDate(plan)}</span>
                            );
                            const actualCell = (
                              <span className={cn(actual ? "font-medium" : "text-muted-foreground", late && "text-destructive")}>
                                {fmtDate(actual)}{late && " ⚠"}
                              </span>
                            );
                            return (
                              <tr key={s} className="border-t">
                                <td className="px-2 py-1">{STAGE_LABELS[s]}</td>
                                <td className="px-2 py-1">
                                  {canEdit ? (
                                    <AbdEditCellPopover
                                      id={item.id}
                                      field={f.plan}
                                      label={`R${r} ${STAGE_LABELS[s]} Plan`}
                                      editorType="date"
                                      currentValue={plan}
                                      onSaved={onFieldSaved}
                                    >{planCell}</AbdEditCellPopover>
                                  ) : planCell}
                                </td>
                                <td className="px-2 py-1">
                                  {canEdit ? (
                                    <AbdEditCellPopover
                                      id={item.id}
                                      field={f.actual}
                                      label={`R${r} ${STAGE_LABELS[s]} Actual`}
                                      editorType="date"
                                      currentValue={actual}
                                      onSaved={onFieldSaved}
                                      lockedReason={
                                        isDfActualBlocked(item as any, f.actual)
                                          ? OCS_DF_BLOCK_MESSAGE
                                          : isDsActualBlocked(item as any, f.actual)
                                            ? MF_DS_BLOCK_MESSAGE
                                            : null
                                      }
                                    >{actualCell}</AbdEditCellPopover>
                                  ) : actualCell}
                                </td>
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

            {/* Aconex Sync */}
            {(item.aconex_status_raw || item.aconex_review_status_raw || item.aconex_last_synced_at || item.aconex_date_modified) && (
              <section ref={aconexRef} data-section="aconex" className="scroll-mt-4">
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                  Aconex <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </h3>
                <div className="rounded-md border p-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div><span className="text-muted-foreground">Status</span><div className="font-medium">{item.aconex_status_raw ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Review</span><div className="font-medium">{item.aconex_review_status_raw ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Date Modified</span><div className="font-medium">{fmtDate(item.aconex_date_modified)}</div></div>
                  <div><span className="text-muted-foreground">Last Synced</span><div className="font-medium">{item.aconex_last_synced_at ? new Date(item.aconex_last_synced_at).toLocaleString("ko-KR", { hour12: false }) : "—"}</div></div>
                </div>
              </section>
            )}

            {/* Change Log */}
            <AbdAuditCard
              item={item as any}
              canAudit={!!me && (me.isAdmin || me.isDSuperUser || canEdit)}
              onSaved={onFieldSaved}
            />

            <section>
              <h3 className="font-semibold text-sm mb-2">Change Log</h3>
              {changes.length === 0 ? (
                <p className="text-muted-foreground">변경 이력이 없습니다.</p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-2 py-1.5">When</th>
                        <th className="text-left px-2 py-1.5">Field</th>
                        <th className="text-left px-2 py-1.5">Old</th>
                        <th className="text-left px-2 py-1.5">New</th>
                        <th className="text-left px-2 py-1.5">Src</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{new Date(c.changed_at).toLocaleString("ko-KR", { hour12: false })}</td>
                          <td className="px-2 py-1 font-mono">{c.field}</td>
                          <td className="px-2 py-1">{c.old_value ?? "—"}</td>
                          <td className="px-2 py-1 font-medium">{c.new_value ?? "—"}</td>
                          <td className="px-2 py-1"><Badge variant="outline" className="text-[10px]">{c.source}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Comments */}
            <section ref={commentsRef} data-section="comments" className="scroll-mt-4">
              <h3 className="font-semibold text-sm mb-2">Comments</h3>
              <CommentsThread
                table="abd_comments"
                parentKey="abd_item_id"
                parentValue={item.id}
                categories={ABD_CATEGORIES}
                defaultCategory="general"
              />
            </section>

            {/* Raw Payload */}
            <section>
              <details className="rounded-md border p-2">
                <summary className="cursor-pointer font-semibold text-sm">Raw Payload</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-2 text-[11px]">
                  {JSON.stringify(item.raw_payload ?? {}, null, 2)}
                </pre>
              </details>
            </section>
          </div>
          );
        })()}
    </div>
  );
}