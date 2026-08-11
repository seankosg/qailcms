import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SplOcsCommentRow } from "./SplOcsCommentRow";
import { SplOcsCommentDialog, type SplOcsCommentDraft } from "./SplOcsCommentDialog";
import { useSplOcsComments, useSplOcsMutations } from "./useSplOcs";
import type { SplOcsComment } from "@/lib/spl/ocs.functions";

type TabKey = "all" | "pending" | "complied" | "resolved";

/** SPL 항목의 OCS 원자 코멘트 패널 (조회 + 사용자 편집) */
export function SplOcsPanel({
  splItemId,
  splNumber,
  open,
  onOpenChange,
  onOpenRsp,
}: {
  splItemId: string;
  splNumber: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenRsp: (rspItemId: string) => void;
}) {
  const { data, isLoading } = useSplOcsComments(splItemId, open);
  const m = useSplOcsMutations(splItemId);
  const [tab, setTab] = useState<TabKey>("all");
  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SplOcsComment | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const canWrite = data?.can_write ?? false;
  const busy =
    m.setComplied.isPending ||
    m.setCategory.isPending ||
    m.upsertComment.isPending ||
    m.deactivateComment.isPending;

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (data?.comments ?? []).filter((c) => {
      if (tab === "pending" && (c.is_resolved || c.complied)) return false;
      if (tab === "complied" && !c.complied) return false;
      if (tab === "resolved" && !c.is_resolved) return false;
      if (categoryId && !c.categories.some((x) => x.id === categoryId)) return false;
      if (!t) return true;
      return [c.ocs_number, c.sn, c.comment_text, c.contractor_response, c.source_comment_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t));
    });
  }, [data, tab, term, categoryId]);

  const save = (d: SplOcsCommentDraft) => {
    m.upsertComment.mutate(
      {
        id: d.id,
        splItemId,
        ocsNumber: d.ocsNumber.trim(),
        revision: d.revision.trim(),
        commentText: d.commentText,
        contractorResponse: d.contractorResponse.trim() || null,
        assessedCode: d.assessedCode.trim(),
        signOffStatus: d.signOffStatus.trim(),
      },
      { onSuccess: () => setEditorOpen(false) },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-2 sm:max-w-2xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-sm">
            OCS Comments — <span className="font-mono">{splNumber}</span>
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge variant="outline">Total {data?.total ?? 0}</Badge>
            <Badge variant={data && data.pending > 0 ? "destructive" : "secondary"}>
              Pending {data?.pending ?? 0}
            </Badge>
            <Badge variant="secondary">Complied {data?.complied ?? 0}</Badge>
            <Badge variant="secondary">Resolved {data?.resolved ?? 0}</Badge>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="h-6 text-[11px]">All</TabsTrigger>
            <TabsTrigger value="pending" className="h-6 text-[11px]">Pending</TabsTrigger>
            <TabsTrigger value="complied" className="h-6 text-[11px]">Complied</TabsTrigger>
            <TabsTrigger value="resolved" className="h-6 text-[11px]">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="Search OCS no. / text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {canWrite && (
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1 text-[11px]"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          )}
        </div>

        {(data?.categories_all ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px]",
                categoryId === null && "bg-primary text-primary-foreground",
              )}
            >
              All categories
            </button>
            {(data?.categories_all ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px]",
                  categoryId === c.id && "bg-primary text-primary-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="-mx-1 flex-1 px-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : rows.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">표시할 코멘트가 없습니다.</p>
          ) : (
            <div className="space-y-2 pb-6">
              {rows.map((c) => (
                <SplOcsCommentRow
                  key={c.id}
                  comment={c}
                  canWrite={canWrite}
                  busy={busy}
                  categoriesAll={data?.categories_all ?? []}
                  onToggleComplied={(next) =>
                    m.setComplied.mutate({ commentId: c.id, expected: c.complied, complied: next })
                  }
                  onToggleCategory={(categoryIdArg, on) =>
                    m.setCategory.mutate({ commentId: c.id, categoryId: categoryIdArg, on })
                  }
                  onOpenRsp={onOpenRsp}
                  onEdit={() => {
                    setEditing(c);
                    setEditorOpen(true);
                  }}
                  onDeactivate={() => {
                    const reason = window.prompt("비활성화 사유를 입력하세요");
                    if (reason && reason.trim()) m.deactivateComment.mutate({ id: c.id, reason: reason.trim() });
                  }}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <SplOcsCommentDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          comment={editing}
          busy={m.upsertComment.isPending}
          onSave={save}
        />
      </SheetContent>
    </Sheet>
  );
}
