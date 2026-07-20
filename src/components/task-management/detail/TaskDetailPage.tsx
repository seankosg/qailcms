import { useMemo } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCcw, ShieldCheck, ShieldOff } from "lucide-react";
import {
  TM_COLUMNS,
  DISCIPLINE_COLORS,
  TEAM_COLORS,
  TEAM_FALLBACK_COLOR,
  RISK_COLORS,
  ROW_TYPE_COLORS,
  STATUS_COLORS,
  AUTO_JUDGMENT_COLORS,
  PLOT_COLORS,
  type TmColumnDef,
} from "@/lib/task-management/columns";
import { EditCellPopover } from "../raw-data/EditCellPopover";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";
import { getTaskHistory } from "@/lib/task-management/history.functions";
import { formatDdMmm } from "@/lib/defect-management/stage-utils";
import { cn } from "@/lib/utils";
import { CommentsThread, TASK_CATEGORIES } from "@/components/shared/CommentsThread";

const GROUP_LABELS: Record<TmColumnDef["group"], string> = {
  id: "Identification",
  task: "Task",
  status: "Status",
  plan: "Plan",
  actual: "Actual",
  forecast: "Forecast",
  system: "System",
};

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  import: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  rollup: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  system: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export function TaskDetailPage() {
  const { id } = useParams({ from: "/_authenticated/closure/task-management/detail/$id" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const isAdmin = !!(user as any)?.isAdmin;
  const isDSuperUser = !!(user as any)?.isDSuperUser;
  const canEditTaskNo = isAdmin || isDSuperUser;
  const resolveLabel = useTmColumnLabel();
  const fetchHistory = useServerFn(getTaskHistory);

  const { data: row, refetch, isFetching } = useQuery({
    queryKey: ["task-detail", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, any> | null;
    },
  });

  const { data: history } = useQuery({
    queryKey: ["task-detail-history", row?.discipline, row?.task_no],
    queryFn: async () => {
      if (!row?.discipline || !row?.task_no) return { rows: [] as any[] };
      return await fetchHistory({ data: { discipline: String(row.discipline), task_no: String(row.task_no), limit: 100 } });
    },
    enabled: !!row?.discipline && !!row?.task_no,
  });

  const grouped = useMemo(() => {
    const g: Record<string, TmColumnDef[]> = {};
    for (const c of TM_COLUMNS) (g[c.group] ??= []).push(c);
    return g;
  }, []);

  if (!row) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {isFetching ? "로딩 중..." : "Task를 찾을 수 없습니다"}
      </div>
    );
  }

  const isParent = row.level === "main";

  const onFieldSaved = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["task-detail-history", row.discipline, row.task_no] });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록
          </Button>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <span className="font-mono">{row.task_no ?? "—"}</span>
            {row.discipline && (
              <Badge className={cn("text-[10px]", DISCIPLINE_COLORS[String(row.discipline)] ?? TEAM_FALLBACK_COLOR)}>
                {row.discipline}
              </Badge>
            )}
            {row.team && (
              <Badge className={cn("text-[10px]", TEAM_COLORS[String(row.team)] ?? TEAM_FALLBACK_COLOR)}>
                {row.team}
              </Badge>
            )}
            {row.task_name && <span className="text-sm font-normal text-muted-foreground">· {row.task_name}</span>}
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
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[grp as TmColumnDef["group"]] ?? grp}
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
                {cols.map((c) => {
                  const v = row[c.key];
                  const display = renderFieldValue(c, v);
                  // task_no는 컬럼 정의상 non-editable이지만 Admin/Super User(d_superuser)는 상세페이지에서 편집 허용
                  const isTaskNoOverride = c.key === "task_no" && canEditTaskNo;
                  const effectiveColumn: TmColumnDef = isTaskNoOverride
                    ? { ...c, editable: true, editorType: "text" }
                    : c;
                  const effectiveCanEdit = isTaskNoOverride ? canEditTaskNo : isAdmin;
                  const editable =
                    !!effectiveColumn.editable &&
                    !!effectiveColumn.editorType &&
                    !(c.key === "actual_progress" && isParent);
                  return (
                    <div key={c.key} className="flex items-baseline gap-2">
                      <div className="min-w-[110px] text-[11px] text-muted-foreground">
                        {resolveLabel(c.key)}
                      </div>
                      <div className="flex-1 text-xs">
                        {editable ? (
                          <EditCellPopover
                            rowId={String(row.id)}
                            column={effectiveColumn}
                            currentValue={v}
                            canEdit={effectiveCanEdit}
                            onSaved={onFieldSaved}
                          >
                            {display}
                          </EditCellPopover>
                        ) : (
                          display
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
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Status History
            </div>
            {(history?.rows ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground">이력 없음</div>
            ) : (
              <ul className="space-y-2 text-xs">
                {(history?.rows ?? []).map((h: any) => (
                  <li key={h.id} className="rounded border-l-2 border-primary/40 bg-muted/30 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{resolveLabel(h.field) ?? h.field}</span>
                      {h.source && (
                        <Badge className={cn("text-[10px]", SOURCE_COLORS[h.source] ?? "bg-muted")}>
                          {h.source}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {h.old_value ?? "—"} →{" "}
                      <span className="font-medium text-foreground">{h.new_value ?? "—"}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {h.changed_at ? new Date(h.changed_at).toLocaleString() : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Comments
            </div>
            <CommentsThread
              table="task_comments"
              parentKey="task_raw_id"
              parentValue={String(row.id)}
              categories={TASK_CATEGORIES}
              defaultCategory="general"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function renderFieldValue(c: TmColumnDef, v: any) {
  if (v == null || v === "") return <span className="text-muted-foreground/50">—</span>;
  if (c.type === "badge") {
    const s = String(v);
    const palette =
      c.key === "discipline"
        ? DISCIPLINE_COLORS
        : c.key === "team"
          ? TEAM_COLORS
          : c.key === "risk"
            ? RISK_COLORS
            : c.key === "row_type"
              ? ROW_TYPE_COLORS
              : c.key === "status_manual"
                ? STATUS_COLORS
                : c.key === "auto_judgment"
                  ? AUTO_JUDGMENT_COLORS
                  : c.key === "plot"
                    ? PLOT_COLORS
                    : undefined;
    return <Badge className={cn("text-[10px]", palette?.[s] ?? TEAM_FALLBACK_COLOR)}>{s}</Badge>;
  }
  if (c.type === "date") return <span className="tabular-nums">{formatDdMmm(v)}</span>;
  if (c.type === "percent") {
    const n = Number(v);
    const pct = n > 1 ? n : n * 100;
    return <span className="tabular-nums">{isNaN(pct) ? String(v) : pct.toFixed(1) + "%"}</span>;
  }
  if (c.type === "number") return <span className="tabular-nums">{String(v)}</span>;
  if (c.type === "boolean")
    return v ? (
      <Badge className="text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300">Yes</Badge>
    ) : (
      <span className="text-muted-foreground/50">No</span>
    );
  return <span className="whitespace-pre-wrap">{String(v)}</span>;
}