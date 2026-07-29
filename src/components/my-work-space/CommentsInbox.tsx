import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, ChevronDown, ChevronRight, CheckCheck, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useCommentInbox, type InboxComment, type InboxModule } from "@/hooks/useCommentInbox";
import { useCommentInboxRead } from "@/hooks/useCommentInboxRead";

interface Props {
  userId: string | null | undefined;
  scope: "pic" | "team";
  filterValue: string | null;
  isAdmin: boolean;
}

type TabKey = "all" | "vp_pd" | InboxModule;

const MODULE_META: Record<InboxModule, { label: string; tone: string }> = {
  tm: { label: "TM", tone: "border-info text-info" },
  sm: { label: "SM", tone: "border-warning text-warning" },
  abd: { label: "ABD", tone: "border-success text-success" },
  sp: { label: "SP", tone: "border-primary text-primary" },
};

function detailHref(c: InboxComment): { to: string; params?: any; search?: any } {
  switch (c.module) {
    case "tm":
      return { to: "/closure/task-management/detail/$id", params: { id: c.parent_id } };
    case "sm":
      return { to: "/closure/snag-management/detail/$id", params: { id: c.parent_id } };
    case "abd":
      return { to: "/closure/abd/detail/$id", params: { id: c.parent_id }, search: { focus: "comments" } };
    case "sp":
      return { to: "/closure/spare-part/records/$docRef", params: { docRef: c.parent_id } };
  }
}

export function CommentsInbox({ userId, scope, filterValue, isAdmin }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("all");
  const [collapsed, setCollapsed] = useState(true);

  const { data: rows = [], isLoading, isFetching } = useCommentInbox({ userId, scope, filterValue, isAdmin });
  const { isRead, markRead, markManyRead } = useCommentInboxRead(userId);

  const perModule = useMemo(() => {
    const c = { tm: 0, sm: 0, abd: 0, sp: 0 } as Record<InboxModule, number>;
    let unreadTotal = 0;
    const unreadPerMod = { tm: 0, sm: 0, abd: 0, sp: 0 } as Record<InboxModule, number>;
    let vpTotal = 0;
    let vpUnread = 0;
    for (const r of rows) {
      c[r.module] += 1;
      if (!isRead(r.id, r.updated_at)) {
        unreadTotal += 1;
        unreadPerMod[r.module] += 1;
      }
      if (r.author_is_vp_pd) {
        vpTotal += 1;
        if (!isRead(r.id, r.updated_at)) vpUnread += 1;
      }
    }
    return { counts: c, total: rows.length, unreadTotal, unreadPerMod, vpTotal, vpUnread };
  }, [rows, isRead]);

  const shown = useMemo(
    () =>
      tab === "all"
        ? rows
        : tab === "vp_pd"
          ? rows.filter((r) => r.author_is_vp_pd)
          : rows.filter((r) => r.module === tab),
    [rows, tab],
  );

  function open(c: InboxComment) {
    markRead(c.id, c.updated_at);
    const href = detailHref(c);
    navigate(href as any);
  }

  function markAllShown() {
    markManyRead(shown.map((c) => ({ id: c.id, updated_at: c.updated_at })));
  }

  return (
    <section className="rounded-lg border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b">
        <button
          type="button"
          aria-label={collapsed ? "펼치기" : "접기"}
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent text-muted-foreground"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">내 항목 댓글</h2>
        {perModule.unreadTotal > 0 && (
          <Badge variant="destructive" className="h-5 rounded-full px-2 text-[10px]">
            {perModule.unreadTotal} unread
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          총 {perModule.total}건{isFetching && !isLoading ? " · 갱신중" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={markAllShown}
            disabled={shown.length === 0}
          >
            <CheckCheck className="h-3.5 w-3.5 mr-1" />
            모두 읽음
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {(["all", "vp_pd", "tm", "sm", "abd", "sp"] as TabKey[]).map((k) => {
              const total =
                k === "all"
                  ? perModule.total
                  : k === "vp_pd"
                    ? perModule.vpTotal
                    : perModule.counts[k as InboxModule];
              const unread =
                k === "all"
                  ? perModule.unreadTotal
                  : k === "vp_pd"
                    ? perModule.vpUnread
                    : perModule.unreadPerMod[k as InboxModule];
              const label =
                k === "all" ? "전체" : k === "vp_pd" ? "VP/PD" : MODULE_META[k as InboxModule].label;
              const isVp = k === "vp_pd";
              return (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors flex items-center gap-1.5",
                    isVp
                      ? cn(
                          "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800",
                          tab === k ? "bg-neutral-950" : "bg-neutral-900",
                        )
                      : tab === k
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                  <span className="tabular-nums opacity-70">{total}</span>
                  {unread > 0 && (
                    <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* List */}
          <ScrollArea className="h-[260px]">
            <ul className="divide-y">
              {isLoading && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">불러오는 중…</li>
              )}
              {!isLoading && shown.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                  표시할 댓글이 없습니다.
                </li>
              )}
              {shown.map((c) => {
                const unread = !isRead(c.id, c.updated_at);
                const meta = MODULE_META[c.module];
                const when = c.updated_at ? formatDistanceToNow(new Date(c.updated_at), { addSuffix: true }) : "";
                return (
                  <li
                    key={`${c.module}-${c.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(c)}
                    onKeyDown={(e) => { if (e.key === "Enter") open(c); }}
                    className={cn(
                      "group flex flex-col gap-1 px-3 py-2 cursor-pointer transition-colors border-l-2",
                      unread
                        ? "border-l-primary bg-primary/5 hover:bg-primary/10"
                        : "border-l-transparent hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <Badge variant="outline" className={cn("h-4 rounded px-1.5 text-[10px]", meta.tone)}>
                        {meta.label}
                      </Badge>
                      {c.category && (
                        <Badge variant="outline" className="h-4 rounded px-1.5 text-[10px] text-muted-foreground">
                          {c.category}
                        </Badge>
                      )}
                      {unread && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      <span className="ml-auto text-muted-foreground">{when}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={cn("font-mono", unread ? "font-semibold" : "text-muted-foreground")}>
                        {c.parent_ref ?? c.parent_id.slice(0, 8)}
                      </span>
                      <span className="truncate text-muted-foreground">{c.parent_label ?? ""}</span>
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </div>
                    <p
                      className={cn(
                        "text-xs leading-snug line-clamp-2",
                        unread ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c.message}
                    </p>
                    <div className="text-[10px] text-muted-foreground">
                      {c.author_name ?? "user"}
                      {c.edited ? " · (수정됨)" : ""}
                    </div>
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