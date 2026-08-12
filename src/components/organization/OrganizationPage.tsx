/**
 * Project Wide > Organization
 * 전 사용자 업무 이관(위임) 현황 요약 화면. 읽기 전용.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { todayInDoha } from "@/lib/time/doha";
import { ArrowRight, Users, UserCog, CalendarClock, CheckCircle2 } from "lucide-react";

interface Row {
  id: string;
  task_raw_id: string;
  from_pic: string;
  to_pic: string;
  start_date: string;
  end_date: string;
  status: string;
  note: string | null;
  task?: { task_no: string | null; task_name: string | null; team: string | null; plot: string | null; discipline: string | null } | null;
}

type Phase = "active" | "scheduled" | "ended" | "cancelled";

function phaseOf(r: Row, asOf: string): Phase {
  if (r.status !== "active") return "cancelled";
  if (r.start_date > asOf) return "scheduled";
  if (r.end_date < asOf) return "ended";
  return "active";
}

const PHASE_LABEL: Record<Phase, string> = {
  active: "진행 중",
  scheduled: "예정",
  ended: "종료",
  cancelled: "취소",
};

function todayIso() {
  try { return todayInDoha(); } catch { return new Date().toISOString().slice(0, 10); }
}

export function OrganizationPage() {
  const [asOf, setAsOf] = useState(todayIso());
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Phase | "all">("active");

  const rowsQ = useQuery<Row[]>({
    queryKey: ["organization", "delegations"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tm_pic_delegations")
        .select(
          "id,task_raw_id,from_pic,to_pic,start_date,end_date,status,note,task:task_management_raw(task_no,task_name,team,plot,discipline)",
        )
        .order("start_date", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const all = rowsQ.data ?? [];
  const tagged = useMemo(() => all.map((r) => ({ r, p: phaseOf(r, asOf) })), [all, asOf]);

  const counts = useMemo(() => {
    const c: Record<Phase, number> = { active: 0, scheduled: 0, ended: 0, cancelled: 0 };
    tagged.forEach((t) => { c[t.p] += 1; });
    return c;
  }, [tagged]);

  const activeRows = useMemo(() => tagged.filter((t) => t.p === "active").map((t) => t.r), [tagged]);
  const givers = new Set(activeRows.map((r) => r.from_pic));
  const takers = new Set(activeRows.map((r) => r.to_pic));

  const scheduledRows = useMemo(() => tagged.filter((t) => t.p === "scheduled").map((t) => t.r), [tagged]);

  /** 사용자별 인계·인수 집계 — 단계별로 따로 센다 */
  const summarize = (list: DelegRow[]) => {
    const m = new Map<string, { name: string; out: number; inn: number }>();
    const touch = (n: string) => {
      if (!m.has(n)) m.set(n, { name: n, out: 0, inn: 0 });
      return m.get(n)!;
    };
    list.forEach((r) => { touch(r.from_pic).out += 1; touch(r.to_pic).inn += 1; });
    return Array.from(m.values()).sort((x, y) => (y.inn + y.out) - (x.inn + x.out) || x.name.localeCompare(y.name));
  };
  const perPersonActive = useMemo(() => summarize(activeRows), [activeRows]);
  const perPersonScheduled = useMemo(() => summarize(scheduledRows), [scheduledRows]);
  const [summaryTab, setSummaryTab] = useState<"scheduled" | "active">("active");
  const perPerson = summaryTab === "active" ? perPersonActive : perPersonScheduled;

  const flows = useMemo(() => {
    const m = new Map<string, { from: string; to: string; n: number }>();
    activeRows.forEach((r) => {
      const k = r.from_pic + "\u0001" + r.to_pic;
      const cur = m.get(k) ?? { from: r.from_pic, to: r.to_pic, n: 0 };
      cur.n += 1;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }, [activeRows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tagged
      .filter((t) => (phase === "all" ? true : t.p === phase))
      .filter((t) => {
        if (!s) return true;
        const r = t.r;
        return `${r.from_pic} ${r.to_pic} ${r.task?.task_no ?? ""} ${r.task?.task_name ?? ""} ${r.task?.team ?? ""}`
          .toLowerCase()
          .includes(s);
      })
      .slice(0, 1000);
  }, [tagged, phase, q]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Organization</h1>
          <p className="text-sm text-muted-foreground">
            전 사용자 업무 이관(위임) 현황 요약. 원 담당자 기록은 유지되며 기간 종료 시 자동 복귀합니다.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">기준일</Label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAsOf(todayIso())}>오늘</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={UserCog} label="진행 중 이관" value={counts.active} sub={`${asOf} 기준`} />
        <KpiCard icon={Users} label="인계자 / 인수자" value={`${givers.size} / ${takers.size}`} sub="진행 중 기준 인원 수" />
        <KpiCard icon={CalendarClock} label="예정" value={counts.scheduled} sub="시작 전 위임" />
        <KpiCard icon={CheckCircle2} label="종료 · 취소" value={`${counts.ended} · ${counts.cancelled}`} sub="원 담당자 복귀" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">사용자별 이관 요약</CardTitle>
            <Tabs value={summaryTab} onValueChange={(v) => setSummaryTab(v as "scheduled" | "active")}>
              <TabsList className="h-8">
                <TabsTrigger value="scheduled" className="h-6 px-2 text-xs">
                  예정 <span className="ml-1 tabular-nums opacity-70">{counts.scheduled}</span>
                </TabsTrigger>
                <TabsTrigger value="active" className="h-6 px-2 text-xs">
                  진행 중 <span className="ml-1 tabular-nums opacity-70">{counts.active}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">이름</th>
                    <th className="py-1 text-right font-medium">인계</th>
                    <th className="py-1 text-right font-medium">인수</th>
                    <th className="py-1 text-right font-medium">순증감</th>
                  </tr>
                </thead>
                <tbody>
                  {perPerson.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">{summaryTab === "active" ? "진행 중" : "예정된"} 이관이 없습니다.</td></tr>
                  )}
                  {perPerson.map((p) => {
                    const net = p.inn - p.out;
                    return (
                      <tr key={p.name} className="border-b last:border-0">
                        <td className="py-1">{p.name}</td>
                        <td className="py-1 text-right">{p.out || "-"}</td>
                        <td className="py-1 text-right">{p.inn || "-"}</td>
                        <td className={`py-1 text-right font-medium ${net > 0 ? "text-warning" : net < 0 ? "text-muted-foreground" : ""}`}>
                          {net > 0 ? `+${net}` : net}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">이관 흐름 (진행 중)</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              <div className="space-y-1 pr-2">
                {flows.length === 0 && (
                  <div className="py-4 text-center text-xs text-muted-foreground">진행 중 이관이 없습니다.</div>
                )}
                {flows.map((f) => (
                  <div key={`${f.from}-${f.to}`} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
                    <span className="truncate">{f.from}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{f.to}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">{f.n}건</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            이관 상세
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {(["active", "scheduled", "ended", "cancelled", "all"] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={phase === p ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setPhase(p)}
                >
                  {p === "all" ? "전체" : PHASE_LABEL[p as Phase]}
                </Button>
              ))}
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름 / Task No / 팀 검색"
                className="h-7 w-52 text-xs"
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rowsQ.isLoading && <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중…</div>}
          {!rowsQ.isLoading && (
            <ScrollArea className="h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 text-left font-medium">상태</th>
                    <th className="py-1 text-left font-medium">Task No</th>
                    <th className="py-1 text-left font-medium">Task Name</th>
                    <th className="py-1 text-left font-medium">Plot</th>
                    <th className="py-1 text-left font-medium">Team</th>
                    <th className="py-1 text-left font-medium">인계 → 인수</th>
                    <th className="py-1 text-left font-medium">기간</th>
                    <th className="py-1 text-left font-medium">사유</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">표시할 이관이 없습니다.</td></tr>
                  )}
                  {filtered.map(({ r, p }) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1">
                        <Badge variant={p === "active" ? "default" : p === "scheduled" ? "secondary" : "outline"} className="text-[10px]">
                          {PHASE_LABEL[p]}
                        </Badge>
                      </td>
                      <td className="py-1 font-mono">{r.task?.task_no ?? "-"}</td>
                      <td className="max-w-[280px] truncate py-1 text-muted-foreground">{r.task?.task_name ?? ""}</td>
                      <td className="py-1">{r.task?.plot ?? "-"}</td>
                      <td className="py-1">{r.task?.team ?? "-"}</td>
                      <td className="whitespace-nowrap py-1">{r.from_pic} → <span className="font-medium">{r.to_pic}</span></td>
                      <td className="whitespace-nowrap py-1 text-muted-foreground">{r.start_date} ~ {r.end_date}</td>
                      <td className="max-w-[160px] truncate py-1 text-muted-foreground">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string | number; sub: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold leading-tight">{value}</div>
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );
}
