import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Clock, CalendarClock, ChevronDown, ChevronUp, ArrowRight, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAbdAttentionInbox, type AbdAttentionKind, type AbdAttentionRow } from "@/hooks/useAbdAttentionInbox";
import { useCommentInboxRead } from "@/hooks/useCommentInboxRead";

interface Props {
  userId: string | null | undefined;
  scope: "pic" | "team";
  filterValue: string | null;
  isAdmin: boolean;
}

type Tab = "needs_plan" | "delayed" | "upcoming";

const META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  needs_plan: { label: "계획필요", icon: AlertTriangle, tone: "border-destructive text-destructive" },
  delayed:    { label: "지연",     icon: Clock,          tone: "border-destructive text-destructive" },
  upcoming:   { label: "임박 (3d)", icon: CalendarClock, tone: "border-warning text-warning" },
};

function rowKey(r: AbdAttentionRow): string { return `abd-att:${r.kind}:${r.id}`; }
function rowStamp(r: AbdAttentionRow): string { return `${r.updated_at ?? ""}|${r.plan_date ?? ""}|${r.days ?? ""}|${r.next_round ?? ""}`; }

export function AttentionInbox({ userId, scope, filterValue, isAdmin }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("needs_plan");
  const [collapsed, setCollapsed] = useState(false);

  const { data: rows = [], isLoading, isFetching } = useAbdAttentionInbox({ isAdmin, scope, filterValue, userId });
  const { isRead, markRead, markManyRead } = useCommentInboxRead(userId);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { needs_plan: 0, delayed: 0, upcoming: 0 };
    const unread: Record<Tab, number> = { needs_plan: 0, delayed: 0, upcoming: 0 };
    for (const r of rows) {
      c[r.kind] += 1;
      if (!isRead(rowKey(r), rowStamp(r))) unread[r.kind] += 1;
    }
    return { c, unread, total: rows.length, unreadTotal: unread.needs_plan + unread.delayed + unread.upcoming };
  }, [rows, isRead]);

  const shown = useMemo(() => rows.filter((r) => r.kind === tab), [rows, tab]);

  function openRow(r: AbdAttentionRow) {
    markRead(rowKey(r), rowStamp(r));
    navigate({ to: "/closure/abd/raw-data", search: { detail: r.id } as any });
  }
  function markAllShown() {
    markManyRead(shown.map((r) => ({ id: rowKey(r), updated_at: rowStamp(r) })));
  }

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">ABD Attention</h2>
        {counts.unreadTotal > 0 && (
          <Badge variant="destructive" className="h-5 rounded-full px-2 text-[10px]">
            {counts.unreadTotal} new
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          총 {counts.total}건{isFetching && !isLoading ? " · 갱신중" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllShown} disabled={shown.length === 0}>
            <CheckCheck className="h-3.5 w-3.5 mr-1" /> 모두 읽음
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "펼치기" : "접기"}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {(Object.keys(META) as Tab[]).map((k) => {
              const M = META[k];
              const total = counts.c[k];
              const un = counts.unread[k];
              return (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors flex items-center gap-1.5",
                    tab === k
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  <M.icon className="h-3.5 w-3.5" />
                  {M.label}
                  <span className="tabular-nums opacity-70">{total}</span>
                  {un > 0 && (
                    <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                      {un}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <ScrollArea className="max-h-[360px]">
            <ul className="divide-y">
              {isLoading && <li className="px-4 py-6 text-center text-xs text-muted-foreground">불러오는 중…</li>}
              {!isLoading && shown.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">표시할 항목이 없습니다.</li>
              )}
              {shown.map((r) => {
                const unread = !isRead(rowKey(r), rowStamp(r));
                const M = META[r.kind];
                return (
                  <li
                    key={rowKey(r)}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRow(r)}
                    onKeyDown={(e) => { if (e.key === "Enter") openRow(r); }}
                    className={cn(
                      "group flex flex-col gap-1 px-3 py-2 cursor-pointer transition-colors border-l-2",
                      unread ? "border-l-primary bg-primary/5 hover:bg-primary/10" : "border-l-transparent hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <Badge variant="outline" className={cn("h-4 rounded px-1.5 text-[10px]", M.tone)}>{M.label}</Badge>
                      {r.kind === "needs_plan" && r.next_round && (
                        <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px] border-info text-info">{r.next_round} 계획</Badge>
                      )}
                      {r.kind === "delayed" && r.days != null && (
                        <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px] border-destructive text-destructive tabular-nums">D+{r.days}</Badge>
                      )}
                      {r.kind === "upcoming" && r.days != null && (
                        <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px] border-warning text-warning tabular-nums">D-{r.days}</Badge>
                      )}
                      {isAdmin && r.hdec_pic_name && (
                        <span className="ml-auto text-muted-foreground">{r.hdec_pic_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={cn("font-mono", unread ? "font-semibold" : "text-muted-foreground")}>
                        {r.abd_number ?? r.id.slice(0, 8)}
                      </span>
                      <span className="truncate text-muted-foreground">{r.document_title ?? ""}</span>
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </div>
                    {r.plan_date && (
                      <div className="text-[10px] text-muted-foreground">계획일 · {r.plan_date.slice(0, 10)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </>
      )}
    </section>
  );
}