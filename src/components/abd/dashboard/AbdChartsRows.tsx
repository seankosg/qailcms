import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { agingTone, AGING_TONE_CLASS, useAbdSettingsQuery } from "./AbdAgingSettingsPopover";
import { cn } from "@/lib/utils";
import {
  getAbdDashboardApprovalTrend,
  getAbdDashboardAttentionLists,
  getAbdDashboardCrosscut,
} from "@/lib/abd/dashboard.functions";

interface BaseProps {
  plots?: string[];
  teams?: string[];
  batchNo?: string[];
  onOpenRaw: (params: Record<string, string>) => void;
  onOpenDetail?: (id: string, focus?: "rounds" | "aconex" | "comments") => void;
}



/** Row 4 — Approval Trend (last N months, stacked by team) */
export function AbdRow4ApprovalTrend({ plots = [], teams = [], batchNo = [], months = 12 }: BaseProps & { months?: number }) {
  const fn = useServerFn(getAbdDashboardApprovalTrend);
  const { data } = useQuery({
    queryKey: ["abd-dash-trend", plots.join(","), teams.join(","), batchNo.join(","), months],
    queryFn: () => fn({ data: { plots, teams, months, batch_no: batchNo } }),
    staleTime: 30_000,
  });
  const rows = data ?? [];

  const { series, teamList } = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    const teamSet = new Set<string>();
    for (const r of rows) {
      const t = r.team || "—";
      teamSet.add(t);
      const mo = r.month_start;
      const bucket = byMonth.get(mo) ?? { month_start: mo };
      bucket[t] = ((bucket[t] as number) ?? 0) + r.approved_cnt;
      byMonth.set(mo, bucket);
    }
    return {
      series: Array.from(byMonth.values()).sort((a, b) =>
        String(a.month_start).localeCompare(String(b.month_start)),
      ),
      teamList: Array.from(teamSet).sort(),
    };
  }, [rows]);

  const palette = [
    "hsl(217 91% 60%)",
    "hsl(142 71% 45%)",
    "hsl(38 92% 50%)",
    "hsl(280 71% 60%)",
    "hsl(340 82% 52%)",
    "hsl(190 82% 45%)",
  ];
  const totalApproved = rows.reduce((s, r) => s + r.approved_cnt, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3 space-y-0">
        <CardTitle className="text-base">Approval Trend — Last {months} months</CardTitle>
        <span className="text-xs text-muted-foreground">
          Total <span className="font-semibold text-foreground">{totalApproved.toLocaleString()}</span>
        </span>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="month_start"
              tickFormatter={(v) => format(parseISO(String(v)), "MMM-yy")}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
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
              labelFormatter={(v) => format(parseISO(String(v)), "MMM yyyy")}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {teamList.map((t, i) => (
              <Area
                key={t}
                type="monotone"
                stackId="1"
                dataKey={t}
                stroke={palette[i % palette.length]}
                fill={palette[i % palette.length]}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Row 5 — Attention Lists (needs_planning / ur_aging / status_mismatch) */
export function AbdRow6Attention({ plots = [], teams = [], batchNo = [], onOpenRaw, onOpenDetail }: BaseProps) {
  const fn = useServerFn(getAbdDashboardAttentionLists);
  const { data } = useQuery({
    queryKey: ["abd-dash-attention", plots.join(","), teams.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { plots, teams, limit: 20, batch_no: batchNo } }),
    staleTime: 30_000,
  });
  const rows = data ?? [];
  const groups = {
    needs_planning: rows.filter((r) => r.list_kind === "needs_planning"),
    ur_aging: rows.filter((r) => r.list_kind === "ur_aging"),
    status_mismatch: rows.filter((r) => r.list_kind === "status_mismatch"),
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Attention Required</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="needs_planning">
          <TabsList>
            <TabsTrigger value="needs_planning">
              Needs Planning
              <Badge variant="destructive" className="ml-2">
                {groups.needs_planning.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="ur_aging">
              UR Aging
              <Badge variant="secondary" className="ml-2">
                {groups.ur_aging.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="status_mismatch">
              Status Mismatch
              <Badge variant="secondary" className="ml-2">
                {groups.status_mismatch.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          {(["needs_planning", "ur_aging", "status_mismatch"] as const).map((k) => (
            <TabsContent key={k} value={k} className="mt-3">
              <AttentionRows items={groups[k]} kind={k} onOpen={onOpenRaw} onOpenDetail={onOpenDetail} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function AttentionRows({
  items,
  kind,
  onOpen,
  onOpenDetail,
}: {
  items: Array<{
    id: string;
    team: string | null;
    plot: string | null;
    abd_number: string | null;
    document_title: string | null;
    current_stage: string | null;
    ur_aging_days: number | null;
    latest_status: string | null;
    hdec_pic_name: string | null;
  }>;
  kind: "needs_planning" | "ur_aging" | "status_mismatch";
  onOpen: (params: Record<string, string>) => void;
  onOpenDetail?: (id: string, focus?: "rounds" | "aconex" | "comments") => void;
}) {
  const { data: settings } = useAbdSettingsQuery();
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">해당 항목이 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex items-center justify-between gap-3 rounded px-1 py-2 hover:bg-muted/40 cursor-pointer"
          onClick={() => {
            if (onOpenDetail) {
              const focus = kind === "needs_planning" ? "rounds" : kind === "status_mismatch" ? "aconex" : "rounds";
              onOpenDetail(it.id, focus);
            } else {
              onOpen({
                ...(it.team ? { team: it.team } : {}),
                ...(it.hdec_pic_name ? { hdec_pic_name: it.hdec_pic_name } : {}),
              });
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {it.abd_number ?? "—"}
              {it.document_title ? (
                <span className="ml-2 text-muted-foreground font-normal">
                  {it.document_title}
                </span>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {[it.team, it.plot, it.hdec_pic_name, `Stage: ${it.current_stage ?? "—"}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {kind === "ur_aging" && it.ur_aging_days != null && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  AGING_TONE_CLASS[agingTone(it.ur_aging_days, settings)],
                )}
                title={`UR 경과 ${it.ur_aging_days}일 · 임계값 ${settings?.ur_aging_warn_days ?? "?"}/${settings?.ur_aging_late_days ?? "?"}일`}
              >
                {it.ur_aging_days}d
              </span>
            )}
            {kind === "status_mismatch" && it.latest_status && (
              <Badge variant="outline">{it.latest_status}</Badge>
            )}
            {kind === "needs_planning" && (
              <Badge variant="destructive">No Plan</Badge>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Row 6b — DIS × Service Cross-cut */
export function AbdRow6Crosscut({ plots = [], teams = [], batchNo = [], onOpenRaw }: BaseProps) {
  const fn = useServerFn(getAbdDashboardCrosscut);
  const { data } = useQuery({
    queryKey: ["abd-dash-crosscut", plots.join(","), teams.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { plots, teams, batch_no: batchNo } }),
    staleTime: 30_000,
  });
  const rows = data ?? [];

  const disList = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.dis || "—"));
    return Array.from(s).sort();
  }, [rows]);
  const serviceList = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.service || "—"));
    return Array.from(s).sort();
  }, [rows]);

  const grid = useMemo(() => {
    const m = new Map<string, { total: number; approved: number; delayed: number }>();
    for (const r of rows) {
      const k = `${r.dis || "—"}::${r.service || "—"}`;
      const cur = m.get(k) ?? { total: 0, approved: 0, delayed: 0 };
      if (r.bucket === "TOTAL") cur.total += r.cnt;
      else if (r.bucket === "APPROVED") cur.approved += r.cnt;
      else if (r.bucket === "DELAYED") cur.delayed += r.cnt;
      m.set(k, cur);
    }
    return m;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">DIS × Service Cross-cut</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">데이터 없음</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">DIS × Service Cross-cut</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-2 text-left font-medium">DIS \ Service</th>
                {serviceList.map((s) => (
                  <th key={s} className="p-2 text-center font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disList.map((d) => (
                <tr key={d} className="border-t border-border">
                  <td className="p-2 font-medium">{d}</td>
                  {serviceList.map((s) => {
                    const cell = grid.get(`${d}::${s}`);
                    if (!cell || cell.total === 0) {
                      return (
                        <td key={s} className="p-2 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const pct = Math.round((cell.approved / cell.total) * 100);
                    return (
                      <td
                        key={s}
                        className="p-2 text-center cursor-pointer hover:bg-primary/10"
                        onClick={() => onOpenRaw({ dis: d, service: s })}
                      >
                        <div className="text-sm font-semibold tabular-nums">
                          {cell.approved}/{cell.total}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {pct}%
                          {cell.delayed > 0 && (
                            <span className="ml-1 text-destructive">· {cell.delayed}d</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}