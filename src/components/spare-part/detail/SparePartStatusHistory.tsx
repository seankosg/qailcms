import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Reply, X, Pencil, Trash2, Check, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useSparePartStatusHistory,
  type StatusCategory,
  type StatusHistoryRow,
} from "@/hooks/useSparePartStatusHistory";

const CATEGORY_STYLE: Record<StatusCategory, string> = {
  technical: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  supplier: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  internal: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  general: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  technical: "Technical",
  supplier: "Supplier",
  internal: "Internal",
  general: "General",
};

interface Props {
  docRef: string;
}

export function SparePartStatusHistory({ docRef }: Props) {
  const { data: user } = useCurrentUser();
  const { data: rows, refetch, isLoading } = useSparePartStatusHistory(docRef);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<StatusCategory>("general");
  const [replyTo, setReplyTo] = useState<StatusHistoryRow | null>(null);
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
    const top: StatusHistoryRow[] = [];
    const map: Record<string, StatusHistoryRow[]> = {};
    for (const c of rows ?? []) {
      if (c.parent_comment_id) {
        (map[c.parent_comment_id] ||= []).push(c);
      } else {
        top.push(c);
      }
    }
    return { topLevel: top, repliesByParent: map };
  }, [rows]);

  const authorName = (r: StatusHistoryRow) => {
    if (!r.author_user_id) {
      return r.source === "migration" ? "System · Migration" : r.source === "excel_import" ? "System · Excel" : "System";
    }
    return authors[r.author_user_id] ?? "User";
  };

  const canEdit = (r: StatusHistoryRow) => {
    if (!user) return false;
    if (user.isAdmin) return true;
    return !!r.author_user_id && r.author_user_id === user.id;
  };

  const handleSend = async () => {
    if (!user) return toast.error("Sign in required");
    const trimmed = message.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) return toast.error("Message too long (max 2000 chars)");
    setSending(true);
    const parentCategory = replyTo?.category ?? category;
    const { error } = await (supabase as any).from("spare_part_status_history").insert({
      doc_ref: docRef,
      parent_comment_id: replyTo?.id ?? null,
      category: parentCategory,
      message: trimmed,
      source: "app_manual",
      author_user_id: user.id,
    });
    setSending(false);
    if (error) {
      toast.error(`Failed to add: ${error.message}`);
      return;
    }
    setMessage("");
    setReplyTo(null);
    refetch();
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) return toast.error("Message too long");
    const { error } = await (supabase as any)
      .from("spare_part_status_history")
      .update({ message: trimmed, edited: true })
      .eq("id", id);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
      return;
    }
    setEditingId(null);
    setEditText("");
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this comment? Replies will also be removed.")) return;
    const { error } = await (supabase as any).from("spare_part_status_history").delete().eq("id", id);
    if (error) {
      toast.error(`Failed to delete: ${error.message}`);
      return;
    }
    refetch();
  };

  const renderComment = (c: StatusHistoryRow, depth: number, isReply: boolean) => {
    const isEditing = editingId === c.id;
    return (
      <div
        key={c.id}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 16}px` } : undefined}
        className={cn(
          "rounded-md border p-2.5 space-y-1.5",
          isReply ? "bg-muted/40 border-border" : CATEGORY_STYLE[c.category],
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
            {isReply ? "reply" : CATEGORY_LABEL[c.category]}
          </Badge>
          <span className="text-xs font-medium text-foreground">{authorName(c)}</span>
          {c.source !== "app_manual" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {c.source === "migration" ? "migrated" : "excel"}
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

  const renderThread = (c: StatusHistoryRow, depth = 0): JSX.Element => {
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
      <ScrollArea className="h-80 border rounded-md">
        <div className="p-3 space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
          {!isLoading && topLevel.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-8 text-muted-foreground">
              <MessageSquare className="h-5 w-5" />
              <p className="text-xs">No status history yet</p>
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
          <Select value={category} onValueChange={(v) => setCategory(v as StatusCategory)}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="supplier">Supplier</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={replyTo ? "Write a reply…" : "Add a status update…"}
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
      {!user && <p className="text-[11px] text-muted-foreground">Sign in to add status updates.</p>}
    </div>
  );
}