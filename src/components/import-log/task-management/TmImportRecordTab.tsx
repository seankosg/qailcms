import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, X, Download } from "lucide-react";
import { formatDdMmm } from "@/lib/time/doha";
import { toast } from "sonner";
import { exportTmImportRecord } from "./exportTmImportRecord";
import { toDohaDateKey, todayInDoha } from "@/lib/time/doha";

interface PicUser {
  id: string;
  name: string | null;
  login_id: string | null;
  team: string | null;
}

interface LogRow {
  imported_by: string | null;
  started_at: string;
}

function toKstDateKey(iso: string): string {
  // Doha (Asia/Qatar, UTC+3) calendar date key.
  return toDohaDateKey(iso);
}

function todayKstKey(): string {
  return todayInDoha();
}

function addDays(key: string, delta: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function buildDateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function isWeekend(dateKey: string): boolean {
  const d = new Date(dateKey + "T00:00:00Z");
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export function TmImportRecordTab() {
  const { data: me } = useCurrentUser();
  const allowed = !!(me?.isAdmin || me?.isSuperUser);

  const today = todayKstKey();
  const defaultFrom = addDays(today, -29);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [teamFilter, setTeamFilter] = useState<string>("__all");
  const [search, setSearch] = useState("");

  const usersQuery = useQuery({
    queryKey: ["tm-import-record", "users"],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: async (): Promise<PicUser[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,name,login_id,team,user_type,hdec_pic_name,is_active")
        .eq("is_active", true)
        .order("team", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter(
          (r: any) =>
            r.user_type === "hdec_pic" ||
            (r.hdec_pic_name && String(r.hdec_pic_name).trim() !== ""),
        )
        .map((r: any) => ({
          id: r.id,
          name: r.name ?? null,
          login_id: r.login_id ?? null,
          team: r.team ?? null,
        }));
    },
  });

  const logsQuery = useQuery({
    queryKey: ["tm-import-record", "logs", from, to],
    enabled: allowed,
    staleTime: 30_000,
    queryFn: async (): Promise<LogRow[]> => {
      // Fetch Doha [from 00:00, to+1 00:00) as UTC bounds
      const startUtc = new Date(from + "T00:00:00+03:00").toISOString();
      const endUtc = new Date(addDays(to, 1) + "T00:00:00+03:00").toISOString();
      const all: LogRow[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("task_management_import_logs")
          .select("imported_by,started_at")
          .gte("started_at", startUtc)
          .lt("started_at", endUtc)
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as LogRow[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
      }
      return all;
    },
  });

  const dates = useMemo(() => buildDateRange(from, to), [from, to]);

  const countMap = useMemo(() => {
    const map = new Map<string, number>(); // key = `${userId}|${dateKey}`
    for (const row of logsQuery.data ?? []) {
      if (!row.imported_by) continue;
      const dk = toKstDateKey(row.started_at);
      const key = `${row.imported_by}|${dk}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [logsQuery.data]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const u of usersQuery.data ?? []) set.add(u.team ?? "(미지정)");
    return Array.from(set).sort();
  }, [usersQuery.data]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (usersQuery.data ?? []).filter((u) => {
      const t = u.team ?? "(미지정)";
      if (teamFilter !== "__all" && t !== teamFilter) return false;
      if (!q) return true;
      return (
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.login_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [usersQuery.data, teamFilter, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PicUser[]>();
    for (const u of filteredUsers) {
      const t = u.team ?? "(미지정)";
      const arr = groups.get(t) ?? [];
      arr.push(u);
      groups.set(t, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredUsers]);

  if (!allowed) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        이 탭은 Super User 이상만 열람할 수 있습니다.
      </div>
    );
  }

  const isLoading = usersQuery.isLoading || logsQuery.isLoading;

  const handleExport = async () => {
    try {
      await exportTmImportRecord({
        from,
        to,
        dates,
        groups: grouped,
        countMap,
        teamFilter,
        exportedBy: me?.name ?? me?.email ?? "",
      });
      toast.success("Excel 파일이 다운로드되었습니다.");
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">시작일</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">종료일</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const t = todayKstKey();
              setTo(t);
              setFrom(addDays(t, -29));
            }}
          >
            최근 30일
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const t = todayKstKey();
              setTo(t);
              setFrom(t.slice(0, 8) + "01");
            }}
          >
            이번달
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">팀</label>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">전체 팀</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">검색</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 로그인ID"
            className="h-9 w-[220px]"
          />
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={handleExport} disabled={isLoading}>
            <Download className="mr-1 h-4 w-4" />
            Excel 내보내기
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : (
        <MatrixTables dates={dates} groups={grouped} countMap={countMap} today={today} />
      )}
    </div>
  );
}

function MatrixTables({
  dates,
  groups,
  countMap,
  today,
}: {
  dates: string[];
  groups: [string, PicUser[]][];
  countMap: Map<string, number>;
  today: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        표시할 사용자가 없습니다.
      </div>
    );
  }

  const displayDates = [...dates].reverse();

  return (
    <div className="space-y-6">
      {groups.map(([team, users]) => {
        const todayCount = users.filter((u) => (countMap.get(`${u.id}|${today}`) ?? 0) > 0).length;
        const missing = users.length - todayCount;
        return (
          <div key={team} className="rounded-md border bg-card">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <div className="text-sm font-semibold">{team}</div>
              <Badge variant="secondary">{users.length}명</Badge>
              <Badge className="bg-emerald-100 text-emerald-800">오늘 업로드 {todayCount}</Badge>
              <Badge className={missing > 0 ? "bg-red-100 text-red-800" : "bg-slate-100"}>
                오늘 미업로드 {missing}
              </Badge>
            </div>
            <div className="overflow-auto">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-r bg-muted/50 px-2 py-1.5 text-left">
                      이름
                    </th>
                    <th className="sticky left-[100px] z-10 border-b border-r bg-muted/50 px-2 py-1.5 text-left">
                      로그인 ID
                    </th>
                    {displayDates.map((d) => {
                      const wk = isWeekend(d);
                      const isToday = d === today;
                      return (
                        <th
                          key={d}
                          className={`border-b border-r px-1 py-1 text-center font-normal ${
                            wk ? "bg-muted text-muted-foreground" : ""
                          } ${isToday ? "bg-primary/10 font-semibold" : ""}`}
                          title={d}
                        >
                          {formatDdMmm(d)}
                        </th>
                      );
                    })}
                    <th className="border-b border-l-2 border-r px-2 py-1.5 text-center">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    let count = 0;
                    return (
                      <tr key={u.id} className="hover:bg-muted/30">
                        <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r bg-background px-2 py-1">
                          {u.name ?? "(이름없음)"}
                        </td>
                        <td className="sticky left-[100px] z-10 whitespace-nowrap border-b border-r bg-background px-2 py-1 text-muted-foreground">
                          {u.login_id ?? "-"}
                        </td>
                        {displayDates.map((d) => {
                          const c = countMap.get(`${u.id}|${d}`) ?? 0;
                          const wk = isWeekend(d);
                          if (c > 0) count++;
                          const isToday = d === today;
                          return (
                            <td
                              key={d}
                              title={`${d}: ${c}건`}
                              className={`border-b border-r px-1 py-1 text-center ${
                                wk ? "bg-muted/30" : ""
                              } ${isToday ? "bg-primary/5" : ""}`}
                            >
                              {c > 0 ? (
                                <Check className="mx-auto h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <X className="mx-auto h-3.5 w-3.5 text-red-400" />
                              )}
                            </td>
                          );
                        })}
                        <td className="border-b border-l-2 border-r px-2 py-1 text-center font-medium">
                          {count} / {dates.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}