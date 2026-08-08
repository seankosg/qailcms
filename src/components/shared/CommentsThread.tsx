import { useEffect, useMemo, useState, type ReactElement } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Reply, X, Pencil, Trash2, Check, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CommentRecipientPicker } from "@/components/shared/CommentRecipientPicker";

export interface CommentRow {
  id: string;
  parent_comment_id: string | null;
  category: string | null;
  message: string;
  source: string;
  author_user_id: string | null;
  edited: boolean;
  created_at: string;
  updated_at: string;
  recipient_names?: string[] | null;
}

export interface CommentCategoryDef {
  value: string;
  label: string;
  className: string; // tailwind classes for the comment card background
}

interface Props {
  table: string; // e.g. "abd_comments"
  parentKey: string; // e.g. "abd_item_id"
  parentValue: string;
  categories: CommentCategoryDef[];
  defaultCategory?: string | null;
  heightClass?: string;
  emptyLabel?: string;
  /** 수신자(HDEC PIC 다중 지정) 기능 사용 여부 */
  enableRecipients?: boolean;
  /** 기본 선택 수신자 (예: 해당 항목의 HDEC PIC) */
  defaultRecipients?: string[];
}

export function CommentsThread({
  table,
  parentKey,
  parentValue,
  categories,
  defaultCategory,
  heightClass = "h-80",
  emptyLabel = "No comments yet",
  enableRecipients = false,
  defaultRecipients,
}: Props) {
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const queryKey = useMemo(() => [table, parentKey, parentValue] as const, [table, parentKey, parentValue]);

  const { data: rows, isLoading } = useQuery({
    queryKey,
    enabled: !!parentValue,
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select("*")
        .eq(parentKey, parentValue)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CommentRow[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  useEffect(() => {
    if (!parentValue) return;
    const channel = supabase
      .channel(`${table}-${parentValue}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `${parentKey}=eq.${parentValue}` },
        () => invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, parentKey, parentValue]);

  const catMap = useMemo(() => {
    const m: Record<string, CommentCategoryDef> = {};
    for (const c of categories) m[c.value] = c;
    return m;
  }, [categories]);

  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string | null>(
    defaultCategory === undefined ? (categories[0]?.value ?? null) : defaultCategory,
  );
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [recipients, setRecipients] = useState<string[]>(defaultRecipients ?? []);

  useEffect(() => {
    setRecipients(defaultRecipients ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(defaultRecipients ?? []).join("|"), parentValue]);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [authors, setAuthors] = useState<Record<string, string>>({});

  const authorIds = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.author_user_id).filter((v): v is string => !!v))),
    [rows],
  );

  useEffect(() => {
    if (authorIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name, email").in("id", authorIds);
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const p of (data ?? []) as any[]) {
        next[p.id] = p.display_name || p.email || "User";
      }
      setAuthors(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [authorIds.join(",")]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: CommentRow[] = [];
    const map: Record<string, CommentRow[]> = {};
    for (const c of rows ?? []) {
      if (c.parent_comment_id) {
        (map[c.parent_comment_id] ||= []).push(c);
      } else {
        top.push(c);
      }
    }
    return { topLevel: top, repliesByParent: map };
  }, [rows]);

  const authorName = (r: CommentRow) => {
    if (!r.author_user_id) {
      return r.source === "migration" ? "System · Migration" : r.source === "excel_import" ? "System · Excel" : "System";
    }
    return authors[r.author_user_id] ?? "User";
  };

  const canEdit = (r: CommentRow) => {
    if (!user) return false;
    if (user.isAdmin) return true;
    return !!r.author_user_id && r.author_user_id === user.id;
  };

  const handleSend = async () => {
    if (!user) return toast.error("Sign in required");
    const trimmed = message.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) return toast.error("Message too long (max 2000 chars)");
    const parentCategory = replyTo?.category ?? category;
    if (!replyTo && !parentCategory) {
      return toast.error("카테고리를 선택해주세요");
    }
    setSending(true);
    const payload: Record<string, unknown> = {
      [parentKey]: parentValue,
      parent_comment_id: replyTo?.id ?? null,
      category: parentCategory ?? null,
      message: trimmed,
      source: "app_manual",
      author_user_id: user.id,
    };
    if (enableRecipients) payload["recipient_names"] = recipients;
    const { error } = await (supabase as any).from(table).insert(payload);
    setSending(false);
    if (error) {
      toast.error(`Failed to add: ${error.message}`);
      return;
    }
    setMessage("");
    setReplyTo(null);
    if (enableRecipients) setRecipients(defaultRecipients ?? []);
    invalidate();
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) return toast.error("Message too long");
    const { error } = await (supabase as any)
      .from(table)
      .update({ message: trimmed, edited: true })
      .eq("id", id);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
      return;
    }
    setEditingId(null);
    setEditText("");
    invalidate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this comment? Replies will also be removed.")) return;
    const { error } = await (supabase as any).from(table).delete().eq("id", id);
    if (error) {
      toast.error(`Failed to delete: ${error.message}`);
      return;
    }
    invalidate();
  };

  const renderComment = (c: CommentRow, depth: number, isReply: boolean) => {
    const isEditing = editingId === c.id;
    const catDef = c.category ? catMap[c.category] : undefined;
    return (
      <div
        key={c.id}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 16}px` } : undefined}
        className={cn(
          "rounded-md border p-2.5 space-y-1.5",
          isReply ? "bg-muted/40 border-border" : (catDef?.className ?? "bg-muted/30"),
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {(isReply || catDef || c.category) && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              {isReply ? "reply" : (catDef?.label ?? c.category)}
            </Badge>
          )}
          <span className="text-xs font-medium text-foreground">{authorName(c)}</span>
          {c.source !== "app_manual" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {c.source === "migration" ? "migrated" : c.source === "excel_import" ? "excel" : c.source}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
            {c.edited ? " · edited" : ""}
          </span>
          {canEdit(c) && !isEditing && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setEditingId(c.id);
                  setEditText(c.message);
                }}
                className="p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                className="p-0.5 text-muted-foreground hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="space-y-1.5">
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              className="text-sm resize-none"
              maxLength={2000}
            />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => handleSaveEdit(c.id)}>
                <Check className="h-3 w-3 mr-1" /> Save
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap break-words text-foreground">{c.message}</p>
            {user && (
              <div className="flex justify-end">
                <button
                  onClick={() => setReplyTo(c)}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Reply className="h-3 w-3" /> Reply
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderThread = (c: CommentRow, depth = 0): ReactElement => {
    const replies = repliesByParent[c.id] ?? [];
    return (
      <div key={c.id} className="space-y-1.5">
        {renderComment(c, depth, depth > 0)}
        {replies.length > 0 && (
          <div className="space-y-1.5">{replies.map((r) => renderThread(r, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <ScrollArea className={cn(heightClass, "border rounded-md")}>
        <div className="p-3 space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
          {!isLoading && topLevel.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-8 text-muted-foreground">
              <MessageSquare className="h-5 w-5" />
              <p className="text-xs">{emptyLabel}</p>
            </div>
          )}
          {topLevel.map((c) => renderThread(c))}
        </div>
      </ScrollArea>

      {replyTo && (
        <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-md px-2 py-1.5 border">
          <Reply className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">
            Replying to <span className="font-medium text-foreground">{authorName(replyTo)}</span>:{" "}
            {replyTo.message.substring(0, 60)}
            {replyTo.message.length > 60 ? "…" : ""}
          </span>
          <button onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex gap-2 items-end">
        {!replyTo && (
          <Select value={category ?? "__none__"} onValueChange={(v) => setCategory(v === "__none__" ? null : v)}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None —</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
          rows={2}
          className="flex-1 resize-none text-sm min-h-0"
          maxLength={2000}
          disabled={!user || sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button onClick={handleSend} disabled={!user || sending || !message.trim()} size="sm" className="h-9">
          <Send className="h-3.5 w-3.5 mr-1" /> Send
        </Button>
      </div>
      {!user && <p className="text-[11px] text-muted-foreground">Sign in to add comments.</p>}
    </div>
  );
}

export const ABD_CATEGORIES: CommentCategoryDef[] = [
  { value: "drafting",   label: "Drafting",   className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  { value: "submission", label: "Submission", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  { value: "dar",        label: "DAR",        className: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  { value: "general",    label: "General",    className: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30" },
];

export const DEFECT_CATEGORIES: CommentCategoryDef[] = [
  { value: "defect",         label: "Defect",         className: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  { value: "rectification",  label: "Rectification",  className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  { value: "inspection",     label: "Inspection",     className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  { value: "general",        label: "General",        className: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30" },
];

export const TASK_CATEGORIES: CommentCategoryDef[] = [
  { value: "progress",   label: "Progress",   className: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  { value: "subcon",     label: "Subcon",     className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  { value: "commercial", label: "Commercial", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  { value: "quality",    label: "Quality",    className: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  { value: "general",    label: "General",    className: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30" },
];