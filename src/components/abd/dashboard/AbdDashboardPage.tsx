import { nowInDoha } from "@/lib/time/doha";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarIcon,
  RefreshCw,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { AbdRow1Kpis, AbdRow2Kpis } from "./AbdKpiRows";
import {
  AbdRow3StatusDist,
  AbdRow4ApprovalTrend,
  AbdRow5OverdueHeatmap,
  AbdRow6Attention,
  AbdRow6Crosscut,
} from "./AbdChartsRows";
import { AbdAgingSettingsPopover, useAbdSettingsQuery } from "./AbdAgingSettingsPopover";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function AbdDashboardPage() {
  const [asOf, setAsOf] = useState<Date>(() => nowInDoha());
  const [batchFilter, setBatchFilter] = useState<string[]>([]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  // SSOT: 대시보드 상단 필터를 위한 batch 옵션 — abd_items_facets("batch_no")로 조회
  const batchListQ = useQuery<string[]>({
    queryKey: ["abd-batch-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: "batch_no",
        _team: "MECH", // team 무관 조회를 위해 임의값 — 이후 union 대체 예정
        _status_group: null,
        _include_inactive: false,
        _plot: null,
        _q: null,
        _filters: [],
      });
      if (error) return [];
      return ((data ?? []) as any[])
        .map((r) => String(r.value ?? ""))
        .filter((v) => v && v !== "(empty)");
    },
    staleTime: 5 * 60_000,
  });
  // aging 설정을 사전 로드해 하위 카드에서 즉시 사용
  useAbdSettingsQuery();
  const isFetching = false;
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["abd-dash-row1"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-row2"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-status"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-trend"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-overdue"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-attention"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-crosscut"] });
  };

  const openRawData = (params: Record<string, string> = {}) => {
    const search: Record<string, string> = { ...params };
    if (batchFilter.length && !("batch" in search)) {
      search.batch = batchFilter.join(",");
    }
    const progressKeys = ["team", "dis", "service", "hdec_pic_name", "hdec_eng_name", "docAx", "docAxx", "batch"];
    if (progressKeys.some((k) => k in search) && !("source" in search)) {
      search.source = "progress";
    }
    navigate({ to: "/closure/abd/raw-data", search: search as any });
  };

  const batchOptions = useMemo(() => {
    const set = new Set<string>(batchFilter);
    for (const v of batchListQ.data ?? []) set.add(v);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [batchListQ.data, batchFilter]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            As-Built Drawing Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            NS · DS · UR · Approved 5분류와 라운드 진척을 한눈에.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AbdAgingSettingsPopover />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 font-normal">
                <Filter className="h-4 w-4" />
                Batch: {batchFilter.length ? `${batchFilter.length} selected` : "All"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-medium text-muted-foreground">Filter by Batch No.</span>
                {batchFilter.length > 0 && (
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setBatchFilter([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                {batchOptions.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Batch 데이터 없음
                  </div>
                )}
                {batchOptions.map((b) => {
                  const checked = batchFilter.includes(b);
                  return (
                    <label
                      key={b}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setBatchFilter((prev) =>
                            e.target.checked ? [...prev, b] : prev.filter((x) => x !== b),
                          );
                        }}
                      />
                      <span className="truncate">{b}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 font-normal">
                <CalendarIcon className="h-4 w-4" />
                As of: {format(asOf, "dd-MMM-yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={asOf}
                onSelect={(d) => d && setAsOf(d)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Row 1 — 배타적 5분류 (Total / Approved / UR / DS / NS) */}
      <AbdRow1Kpis batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 2 — 지연 (Total / RS / SB / DS / No Plan) */}
      <AbdRow2Kpis batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 3 — Latest Status Distribution + Row 4 — Approval Trend */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <AbdRow3StatusDist batchNo={batchFilter} onOpenRaw={openRawData} />
        </div>
        <div className="xl:col-span-2">
          <AbdRow4ApprovalTrend batchNo={batchFilter} onOpenRaw={openRawData} />
        </div>
      </div>

      {/* Row 5 — Overdue Heatmap */}
      <AbdRow5OverdueHeatmap batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 6 — Attention Lists + Cross-cut */}
      <div className="grid gap-4 xl:grid-cols-2">
        <AbdRow6Attention batchNo={batchFilter} onOpenRaw={openRawData} />
        <AbdRow6Crosscut batchNo={batchFilter} onOpenRaw={openRawData} />
      </div>
    </div>
  );
}

// ── KPI ──────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "ok" | "info" | "warning" | "danger";
  onClick?: () => void;
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : tone === "ok"
          ? "text-emerald-700 dark:text-emerald-300"
          : tone === "info"
            ? "text-primary"
            : "text-foreground";
  return (
    <Card
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "p-4 transition-colors",
        onClick && "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-muted p-1.5">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-3xl font-semibold tabular-nums", toneCls)}>
          {Math.max(0, value).toLocaleString()}
        </span>
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

// ── Focus (donut + funnel + risk) ───────────────────────────────

function FocusCard({ data, className }: { data: AbdDashboardData; className?: string }) {
  const pieData = useMemo(() => {
    const approved = data.approved;
    const overdue = data.overdue;
    const pending = Math.max(0, data.pending - overdue);
    return [
      { name: "Approved", value: approved, fill: "hsl(var(--primary))" },
      { name: "Pending", value: pending, fill: "hsl(var(--muted-foreground) / 0.35)" },
      { name: "Overdue", value: overdue, fill: "hsl(var(--destructive))" },
    ].filter((d) => d.value > 0);
  }, [data]);

  const percent = pct(data.approved, data.total);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-base">Workflow Focus</CardTitle>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          ABD
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="relative h-28 w-28 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Pie
                  data={pieData}
                  innerRadius={36}
                  outerRadius={54}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                >
                  {pieData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tabular-nums">{percent}%</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                approved
              </span>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
            <MiniStat label="Approved" value={data.approved} />
            <MiniStat label="Pending" value={Math.max(0, data.pending - data.overdue)} />
            <MiniStat
              label="Overdue"
              value={data.overdue}
              tone={data.overdue > 0 ? "danger" : undefined}
            />
            <MiniStat
              label="Awaiting"
              value={data.awaitingResponse}
              tone={data.awaitingResponse > 0 ? "warning" : undefined}
            />
          </div>
        </div>

        <StageFunnel data={data} />

        <div className="flex flex-wrap items-center gap-2">
          <RiskChip label="Red" value={data.risk.red} tone="danger" />
          <RiskChip label="Amber" value={data.risk.amber} tone="warning" />
          <RiskChip label="Green" value={data.risk.green} tone="ok" />
          {data.stuck > 0 && <RiskChip label="Stuck" value={data.stuck} tone="warning" />}
        </div>

        <div className="mt-auto pt-1 flex gap-2">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to="/closure/abd/progress">
              Open Progress <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to="/closure/abd/raw-data">
              Open Raw Data <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
      <div
        className={cn(
          "tabular-nums text-base font-semibold",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-amber-700 dark:text-amber-300",
          !tone && "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function RiskChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "ok";
}) {
  const cls =
    tone === "danger"
      ? "bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      {label} <span className="tabular-nums font-semibold">{value}</span>
    </span>
  );
}

function StageFunnel({ data }: { data: AbdDashboardData }) {
  const total = data.total || 1;
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Round funnel
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {ABD_STAGES.map((stage) => {
          const count = data.stageCounts[stage];
          const w = (count / total) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={stage}
              className={cn(
                "h-full border-r border-background last:border-r-0",
                stage === "Approved"
                  ? "bg-primary"
                  : stage === "Pending"
                    ? "bg-muted-foreground/30"
                    : "bg-primary/40",
              )}
              style={{ width: `${w}%` }}
              title={`${stage}: ${count}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-5 gap-x-3 gap-y-1 text-[11px]">
        {ABD_STAGES.map((stage) => (
          <div key={stage} className="flex items-center justify-between gap-2">
            <span className="truncate text-muted-foreground">{stage}</span>
            <span className="tabular-nums font-medium">
              {data.stageCounts[stage].toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trend ────────────────────────────────────────────────────────

function TrendCard({
  trend,
  className,
}: {
  trend: Array<{ date: string; approved: number }>;
  className?: string;
}) {
  const total = trend.reduce((s, p) => s + p.approved, 0);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-base">Approvals — Last 30 Days</CardTitle>
        </div>
        <span className="text-xs text-muted-foreground">
          Total <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
        </span>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="abdApprovedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(parseISO(v), "dd-MMM")}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis
              width={28}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(v) => format(parseISO(String(v)), "dd-MMM-yyyy")}
            />
            <Area
              type="monotone"
              dataKey="approved"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#abdApprovedFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Attention ───────────────────────────────────────────────────

function AttentionSection({
  data,
  onOpen,
}: {
  data: AbdDashboardData;
  onOpen: (params?: Record<string, string>) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Attention Required</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overdue">
          <TabsList>
            <TabsTrigger value="overdue">
              Overdue <Badge variant="destructive" className="ml-2">{data.topOverdue.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="awaiting">
              Awaiting <Badge variant="secondary" className="ml-2">{data.topAwaiting.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="stuck">
              Stuck <Badge variant="secondary" className="ml-2">{data.topStuck.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overdue" className="mt-3">
            <AttentionList items={data.topOverdue} metric="daysLate" metricLabel="days late" tone="danger" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="awaiting" className="mt-3">
            <AttentionList items={data.topAwaiting} metric="daysWaiting" metricLabel="days waiting" tone="warning" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="stuck" className="mt-3">
            <AttentionList items={data.topStuck} metric="daysIdle" metricLabel="days idle" tone="warning" onOpen={onOpen} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AttentionList({
  items,
  metric,
  metricLabel,
  tone,
  onOpen,
}: {
  items: AttentionItem[];
  metric: "daysLate" | "daysWaiting" | "daysIdle";
  metricLabel: string;
  tone: "danger" | "warning";
  onOpen: (params?: Record<string, string>) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">해당 항목이 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => {
        const days = (it[metric] as number | undefined) ?? 0;
        return (
          <li
            key={it.id}
            className="flex items-center justify-between gap-3 py-2 cursor-pointer hover:bg-muted/40 px-1 rounded"
            onClick={() =>
              onOpen({
                ...(it.team ? { team: it.team } : {}),
                ...(it.hdec_pic_name ? { hdec_pic_name: it.hdec_pic_name } : {}),
                ...(it.hdec_eng_name ? { hdec_eng_name: it.hdec_eng_name } : {}),
              })
            }
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{it.label}</div>
              <div className="text-[11px] text-muted-foreground">
                {[it.team, it.hdec_pic_name ?? it.hdec_eng_name, `Stage: ${it.stage}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                tone === "danger"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {days} {metricLabel}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Cross-cut ───────────────────────────────────────────────────

function CrossCutSection({
  data,
  onOpen,
}: {
  data: AbdDashboardData;
  onOpen: (params?: Record<string, string>) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Workload Cross-Cut</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="team">
          <TabsList>
            <TabsTrigger value="team">By Team</TabsTrigger>
            <TabsTrigger value="hdec_pic">By HDEC PIC</TabsTrigger>
            <TabsTrigger value="hdec_eng">By HDEC ENG</TabsTrigger>
            <TabsTrigger value="dis">By DIS</TabsTrigger>
            <TabsTrigger value="batch">By Batch</TabsTrigger>
          </TabsList>
          <TabsContent value="team" className="mt-3">
            <CrossCutList cells={data.byTeam} keyName="team" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="hdec_pic" className="mt-3">
            <CrossCutList cells={data.byHdecPic} keyName="hdec_pic_name" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="hdec_eng" className="mt-3">
            <CrossCutList cells={data.byHdecEng} keyName="hdec_eng_name" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="dis" className="mt-3">
            <CrossCutList cells={data.byDis} keyName="dis" onOpen={onOpen} />
          </TabsContent>
          <TabsContent value="batch" className="mt-3">
            <CrossCutList cells={data.byBatch} keyName="batch" onOpen={onOpen} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CrossCutList({
  cells,
  keyName,
  onOpen,
}: {
  cells: CrossCutCell[];
  keyName: "team" | "hdec_pic_name" | "hdec_eng_name" | "dis" | "batch";
  onOpen: (params?: Record<string, string>) => void;
}) {
  const rows = cells.slice(0, 12);
  const max = Math.max(1, ...rows.map((c) => c.total));
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">데이터 없음</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((c) => {
        const approvedPct = c.total > 0 ? Math.round((c.approved / c.total) * 100) : 0;
        return (
          <div
            key={c.key}
            className="grid grid-cols-[minmax(120px,1fr)_2fr_auto] items-center gap-3 rounded p-2 cursor-pointer hover:bg-muted/40"
            onClick={() => onOpen(c.key === "— Unassigned" ? {} : { [keyName]: c.key })}
          >
            <div className="truncate text-sm font-medium">{c.key}</div>
            <div className="space-y-1">
              <Progress value={approvedPct} className="h-1.5" />
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{c.approved.toLocaleString()} approved / {c.total.toLocaleString()}</span>
                {c.overdue > 0 && (
                  <span className="text-destructive font-medium">{c.overdue} overdue</span>
                )}
              </div>
            </div>
            <div
              className="text-right text-xs tabular-nums"
              style={{ width: 60 }}
            >
              <span className="font-semibold text-foreground">{approvedPct}%</span>
              <div
                className="h-1 rounded bg-muted mt-1"
                title={`${c.total} total`}
              >
                <div
                  className="h-1 rounded bg-primary/60"
                  style={{ width: `${Math.round((c.total / max) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// stage export re-export to appease linter about unused AbdStage import
export type { AbdStage };