import { useMemo } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCcw, ShieldCheck, ShieldOff, Pencil, KeyRound, Check, X } from "lucide-react";
import {
  TM_COLUMNS,
  DISCIPLINE_COLORS,
  DISCIPLINES,
  TEAM_COLORS,
  TEAM_FALLBACK_COLOR,
  RISK_COLORS,
  ROW_TYPE_COLORS,
  STATUS_COLORS,
  AUTO_JUDGMENT_COLORS,
  PLOT_COLORS,
  GROUP_HEADER_BG,
  type TmColumnDef,
} from "@/lib/task-management/columns";
import { EditCellPopover } from "../raw-data/EditCellPopover";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";
import { formatDdMmm } from "@/lib/defect-management/stage-utils";
import { cn } from "@/lib/utils";
import { CommentsThread, TASK_CATEGORIES } from "@/components/shared/CommentsThread";
import { useServerFn } from "@tanstack/react-start";
import { updateTaskOwnerField } from "@/lib/task-management/owner-mutations.functions";
import { canEditRawRow } from "@/lib/auth/roles";
import { useQuery } from "@tanstack/react-query";

const GROUP_LABELS: Record<TmColumnDef["group"], string> = {
  id: "Identification",
  task: "Task",
  status: "Status",
  plan: "Plan",
  actual: "Actual",
  forecast: "Forecast",
  system: "System",
};

// TM_OWNER_MUTATIONS_V2_2026_07_28 — Detail도 Raw Data와 동일하게 서버 함수 경유
const OWNER_FIELDS = new Set(["team", "data_date"]);

export function TaskDetailPage() {
  const { id } = useParams({ from: "/_authenticated/closure/task-management/detail/$id" });
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isAdmin = !!(user as any)?.isAdmin;
  const isSuperUser = !!(user as any)?.isSuperUser;
  const isDSuperUser = !!(user as any)?.isDSuperUser;
  const canEditTaskNo = isAdmin || isDSuperUser;
  const canEditOwnerFieldsBase = isAdmin || isSuperUser; // d_superuser 제외
  const myPic = String((user as any)?.hdec_pic_name ?? "").trim().toLowerCase();
  const resolveLabel = useTmColumnLabel();
  const updateOwnerFieldFn = useServerFn(updateTaskOwnerField);
  const { data: milestoneOptions = [] } = useQuery({
    queryKey: ["tm_milestone_kinds", "active-codes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tm_milestone_kinds")
        .select("kind_code, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: { kind_code: string }) => r.kind_code as string);
    },
    staleTime: 60_000,
  });

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
  const canEditRow = canEditRawRow(user as any, "task_management_raw", row);

  const onFieldSaved = () => {
    refetch();
  };

  return (
    <div className="space-y-3">
      {/* Header row 1 */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={() => router.history.back()}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록
          </Button>
          <span className="truncate font-mono text-lg font-semibold tracking-tight">{row.task_no ?? "—"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canEditRow ? (
            <Badge className="h-5 text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="mr-1 h-3 w-3" />
              {isAdmin || isSuperUser || isDSuperUser ? " 편집" : " Owner 편집"}
            </Badge>
          ) : (
            <Badge className="h-5 text-[10px] bg-zinc-500/15 text-zinc-700 dark:text-zinc-300">
              <ShieldOff className="mr-1 h-3 w-3" /> 읽기전용
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </header>

      {/* Badge strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        {row.level && (
          <Badge variant="outline" className="h-5 text-[10px]">
            {row.level === "main" ? "Main" : "Sub"}
          </Badge>
        )}
        {row.discipline && (
          <Badge className={cn("h-5 text-[10px]", DISCIPLINE_COLORS[String(row.discipline)] ?? TEAM_FALLBACK_COLOR)}>
            {row.discipline}
          </Badge>
        )}
        {row.team && (
          <Badge className={cn("h-5 text-[10px]", TEAM_COLORS[String(row.team)] ?? TEAM_FALLBACK_COLOR)}>
            {row.team}
          </Badge>
        )}
        {row.risk && (
          <Badge className={cn("h-5 text-[10px]", RISK_COLORS[String(row.risk)] ?? TEAM_FALLBACK_COLOR)}>
            {row.risk}
          </Badge>
        )}
        {row.status_manual && (
          <Badge className={cn("h-5 text-[10px]", STATUS_COLORS[String(row.status_manual)] ?? TEAM_FALLBACK_COLOR)}>
            {row.status_manual}
          </Badge>
        )}
        {row.auto_judgment && (
          <Badge className={cn("h-5 text-[10px]", AUTO_JUDGMENT_COLORS[String(row.auto_judgment)] ?? TEAM_FALLBACK_COLOR)}>
            {row.auto_judgment}
          </Badge>
        )}
      </div>

      {row.task_name && (
        <h2 className="truncate text-sm text-foreground" title={String(row.task_name)}>
          {row.task_name}
        </h2>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {Object.entries(grouped).map(([grp, cols]) => (
            <section key={grp} className="rounded-md border bg-card p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    GROUP_HEADER_BG[grp as TmColumnDef["group"]] ?? "bg-muted",
                  )}
                />
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {GROUP_LABELS[grp as TmColumnDef["group"]] ?? grp}
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 md:grid-cols-2 xl:grid-cols-3">
                {cols.map((c) => {
                  const v = row[c.key];
                  let effectiveColumn: TmColumnDef = c;
                  let effectiveCanEdit = canEditRow;
                  if (c.key === "task_no") {
                    effectiveColumn = { ...c, editable: true, editorType: "text" };
                    effectiveCanEdit = canEditTaskNo;
                  } else if (c.key === "team") {
                    effectiveColumn = { ...c, editable: true, editorType: "select", options: [...DISCIPLINES] };
                  } else if (c.key === "data_date") {
                    effectiveColumn = { ...c, editable: true, editorType: "date" };
                  } else if (c.key === "milestone") {
                    effectiveColumn = { ...c, editable: true, editorType: "select", options: milestoneOptions };
                  }
                  const editable =
                    !!effectiveColumn.editable &&
                    !!effectiveColumn.editorType &&
                    effectiveCanEdit &&
                    !(c.key === "actual_progress" && isParent);
                  const isOwnerField = OWNER_FIELDS.has(c.key);
                  const label = resolveLabel(c.key);
                  const display = renderFieldValue(c, v);
                  return (
                    <div
                      key={c.key}
                      className="group flex min-h-[24px] items-center gap-1.5 border-b border-dashed border-border/40 py-0.5 last:border-0"
                    >
                      <dt
                        className="flex w-[92px] shrink-0 items-center justify-end gap-1 text-right text-[10px] uppercase tracking-wide text-muted-foreground"
                        title={label}
                      >
                        {isOwnerField && editable && (
                          <KeyRound className="h-2.5 w-2.5 text-primary/60" aria-label="권한 편집" />
                        )}
                        <span className="truncate">{label}</span>
                      </dt>
                      <dd
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-xs",
                          editable
                            ? "cursor-pointer transition-shadow hover:ring-1 hover:ring-primary/30"
                            : "border-l-2 border-dashed border-muted pl-1.5 text-muted-foreground/80",
                        )}
                        aria-label={editable ? `${label} 편집` : label}
                        role={editable ? "button" : undefined}
                      >
                        {editable ? (
                          <>
                            <EditCellPopover
                              rowId={String(row.id)}
                              column={effectiveColumn}
                              currentValue={v}
                              canEdit={effectiveCanEdit}
                              onSaved={onFieldSaved}
                              onSave={async (value) => {
                                await updateOwnerFieldFn({
                                  data: {
                                    id: String(row.id),
                                    field: effectiveColumn.key,
                                    value: value ?? null,
                                  },
                                });
                              }}
                            >
                              <span className="block min-w-0 truncate">{display}</span>
                            </EditCellPopover>
                            <Pencil className="ml-auto h-2.5 w-2.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                          </>
                        ) : (
                          <span className="block min-w-0 truncate">{display}</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-md border bg-card p-2.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Comments
            </div>
            <CommentsThread
              table="task_comments"
              parentKey="task_raw_id"
              parentValue={String(row.id)}
              categories={TASK_CATEGORIES}
              defaultCategory={null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function renderFieldValue(c: TmColumnDef, v: any) {
  if (v == null || v === "") return <span className="text-[10px] text-muted-foreground/40">—</span>;
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
    return <Badge className={cn("h-4 text-[10px]", palette?.[s] ?? TEAM_FALLBACK_COLOR)}>{s}</Badge>;
  }
  if (c.type === "date") return <span className="font-mono tabular-nums">{formatDdMmm(v)}</span>;
  if (c.type === "percent") {
    const n = Number(v);
    const pct = n > 1 ? n : n * 100;
    if (isNaN(pct)) return <span className="tabular-nums">{String(v)}</span>;
    const clamped = Math.max(0, Math.min(100, pct));
    return (
      <span className="flex w-full items-center gap-1.5">
        <span className="tabular-nums">{pct.toFixed(1)}%</span>
        <span className="relative h-1 flex-1 min-w-[24px] overflow-hidden rounded-full bg-muted">
          <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${clamped}%` }} />
        </span>
      </span>
    );
  }
  if (c.type === "number") return <span className="tabular-nums">{String(v)}</span>;
  if (c.type === "boolean")
    return v ? (
      <Check className="h-3.5 w-3.5 text-rose-600" aria-label="Yes" />
    ) : (
      <X className="h-3.5 w-3.5 text-muted-foreground/50" aria-label="No" />
    );
  return <span className="truncate">{String(v)}</span>;
}