import { useMemo } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCcw, Lock, Unlock, ShieldCheck, ShieldOff } from "lucide-react";
import { DEFECT_COLUMNS, TEAM_COLORS, TEAM_FALLBACK_COLOR, PRIORITY_COLORS } from "@/lib/defect-management/columns";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";
import { EditCellPopover } from "../raw-data/EditCellPopover";
import { DefectStatusBadge } from "../raw-data/DefectStatusBadge";
import { cn } from "@/lib/utils";
import { formatDdMmm } from "@/lib/defect-management/stage-utils";
import { updateDefectField } from "@/lib/defect-management/mutations.functions";
import { toast } from "sonner";

const GROUP_LABELS: Record<string, string> = {
  identity: "Identity", status: "Status", classification: "Classification",
  content: "Content", location: "Location", plan: "Plan", trade: "Trade",
  people: "People", audit: "Audit", dates: "Dates", progress: "Progress",
  refs: "References", flags: "Flags",
};

export function DefectDetailPage() {
  const { id } = useParams({ from: "/_authenticated/closure/snag-management/detail/$id" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const isAdmin = !!user?.isAdmin;
  const helpers = useDefectFieldHelpers();

  const { data: row, refetch, isFetching } = useQuery({
    queryKey: ["defect-detail", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("defect_items_raw").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["defect-status-history", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("defect_status_history").select("*").eq("defect_id", id).order("changed_at", { ascending: false });
      if (error) return [];
      return data ?? [];
    },
  });

  const grouped = useMemo(() => {
    const g: Record<string, typeof DEFECT_COLUMNS> = {};
    for (const c of DEFECT_COLUMNS) {
      (g[c.group] ??= [] as any).push(c);
    }
    return g;
  }, []);

  if (!row) {
    return <div className="p-6 text-sm text-muted-foreground">{isFetching ? "Loading..." : "Defect not found"}</div>;
  }

  const onFieldSaved = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["defect-status-history", id] });
  };

  const toggleLock = async (field: "priority_locked" | "hdec_verification_locked", nextValue: boolean) => {
    try {
      await updateDefectField({ data: { id: row.id, field, value: nextValue } });
      toast.success(nextValue ? "잠금 완료" : "잠금 해제 완료");
      onFieldSaved();
    } catch (e: any) {
      toast.error(`실패: ${e?.message ?? e}`);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.history.back()}><ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록</Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {row.source_issue_no ?? row.issue_no ?? "—"}
            {row.team && <Badge className={cn("ml-2 text-[10px]", TEAM_COLORS[row.team] ?? TEAM_FALLBACK_COLOR)}>{row.team}</Badge>}
            {row.is_critical && <Badge className="ml-1 text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300">Critical</Badge>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="mr-1 h-3 w-3" /> 편집 가능
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-zinc-500/15 text-zinc-700 dark:text-zinc-300">
              <ShieldOff className="mr-1 h-3 w-3" /> 읽기 전용
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {Object.entries(grouped).map(([grp, cols]) => (
            <div key={grp} className="rounded-lg border bg-card p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{GROUP_LABELS[grp] ?? grp}</div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
                {cols.map((c) => {
                  const v = (row as any)[c.key];
                  const display = renderFieldValue(c, v, row);
                  const editable = !!c.editable && !!c.editorType;
                  const lockedFor =
                    c.key === "priority" ? "priority_locked" :
                    c.key === "hdec_verification" ? "hdec_verification_locked" :
                    null;
                  const locked = !!lockedFor && !!row[lockedFor];
                  return (
                    <div key={c.key} className="flex items-baseline gap-2">
                      <div className="min-w-[110px] text-[11px] text-muted-foreground">{helpers.getLabel(c.key)}</div>
                      <div className="flex-1 text-xs flex items-center gap-1">
                        {editable ? (
                          <EditCellPopover
                            id={row.id}
                            field={c.key}
                            label={c.label}
                            editorType={c.editorType!}
                            options={c.options}
                            currentValue={v}
                            locked={locked}
                            canEdit={isAdmin}
                            onSaved={onFieldSaved}
                          >{display}</EditCellPopover>
                        ) : display}
                        {lockedFor && isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1"
                            title={locked ? "잠금 해제" : "잠그기"}
                            onClick={() => toggleLock(lockedFor as any, !locked)}
                          >
                            {locked ? <Unlock className="h-3 w-3 text-amber-600" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status History</div>
            {history.length === 0 ? (
              <div className="text-xs text-muted-foreground">이력 없음</div>
            ) : (
              <ul className="space-y-2 text-xs">
                {history.map((h: any) => (
                  <li key={h.id} className="rounded border-l-2 border-primary/40 bg-muted/30 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{h.field_name}</span>
                      <span className="text-muted-foreground">{h.change_type ?? "update"}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {h.old_value ?? "—"} → <span className="font-medium text-foreground">{h.new_value ?? "—"}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{h.changed_at ? new Date(h.changed_at).toLocaleString() : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderFieldValue(c: typeof DEFECT_COLUMNS[number], v: any, _row: any) {
  if (v == null || v === "") return <span className="text-muted-foreground/50">—</span>;
  if (c.key === "team") return <Badge className={cn("text-[10px]", TEAM_COLORS[String(v)] ?? TEAM_FALLBACK_COLOR)}>{String(v)}</Badge>;
  if (c.key === "priority" || c.key === "hdec_verification") return <Badge className={cn("text-[10px]", PRIORITY_COLORS[String(v)] ?? TEAM_FALLBACK_COLOR)}>{String(v)}</Badge>;
  if (c.key === "status_raw" || c.key === "rectified_status" || c.key === "closure_status" || c.key === "start_status") return <DefectStatusBadge status={v} />;
  if (c.type === "date") return <span className="tabular-nums">{formatDdMmm(v)}</span>;
  if (c.type === "datetime") return <span className="tabular-nums">{new Date(v).toLocaleString()}</span>;
  if (c.type === "percent") {
    const n = Number(v); const pct = n > 1 ? n : n * 100;
    return <span className="tabular-nums">{isNaN(pct) ? String(v) : pct.toFixed(1) + "%"}</span>;
  }
  if (c.type === "longtext") return <span className="whitespace-pre-wrap">{String(v)}</span>;
  if (c.type === "boolean") return v ? <Badge className="text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300">Yes</Badge> : <span className="text-muted-foreground/50">No</span>;
  return <span>{String(v)}</span>;
}