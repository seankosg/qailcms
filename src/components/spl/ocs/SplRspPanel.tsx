import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SplRspDialog, type SplRspDraft } from "./SplRspDialog";
import { useSplOcsMutations, useSplRspItems } from "./useSplOcs";
import type { SplRspItem } from "@/lib/spl/ocs.functions";

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** SPL 항목의 Recommended Spare Parts 패널 (조회 + 사용자 편집) */
export function SplRspPanel({
  splItemId,
  splNumber,
  open,
  onOpenChange,
  focusId,
  onOpenOcs,
}: {
  splItemId: string;
  splNumber: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  focusId?: string | null;
  onOpenOcs: (commentId: string) => void;
}) {
  const { data, isLoading } = useSplRspItems(splItemId, open);
  const m = useSplOcsMutations(splItemId);
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<SplRspItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const canWrite = data?.can_write ?? false;
  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return data?.rows ?? [];
    return (data?.rows ?? []).filter((r) =>
      [r.rsp_number, r.description, r.manufacturer, r.model_or_unique_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [data, term]);

  const save = (d: SplRspDraft) => {
    m.upsertRsp.mutate(
      {
        id: d.id,
        splItemId,
        description: d.description.trim() || null,
        manufacturer: d.manufacturer.trim() || null,
        model: d.model.trim() || null,
        unit: d.unit.trim() || null,
        qtyRequired: num(d.qtyRequired),
        qtyAvailable: num(d.qtyAvailable),
        qtyShort: num(d.qtyShort),
      },
      { onSuccess: () => setEditorOpen(false) },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-2 sm:max-w-2xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-sm">
            Recommended Spare Parts — <span className="font-mono">{splNumber}</span>
          </SheetTitle>
          <Badge variant="outline" className="w-fit text-[11px]">Total {data?.total ?? 0}</Badge>
        </SheetHeader>

        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="Search RSP no. / description"
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

        <ScrollArea className="-mx-1 flex-1 px-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : rows.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">등록된 RSP 항목이 없습니다.</p>
          ) : (
            <div className="space-y-2 pb-6">
              {rows.map((r) => (
                <div
                  key={r.id}
                  id={`spl-rsp-${r.id}`}
                  className={cn(
                    "rounded-md border p-2.5 text-xs",
                    focusId === r.id && "ring-2 ring-primary",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-semibold">{r.rsp_number}</span>
                      {r.is_user_created && <Badge variant="secondary" className="text-[10px]">User added</Badge>}
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1"
                          aria-label="Edit RSP item"
                          onClick={() => {
                            setEditing(r);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1 text-destructive"
                          aria-label="Deactivate RSP item"
                          onClick={() => {
                            const reason = window.prompt("비활성화 사유를 입력하세요");
                            if (reason && reason.trim()) m.deactivateRsp.mutate({ id: r.id, reason: reason.trim() });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words">{r.description ?? "—"}</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground md:grid-cols-3">
                    <div>Manufacturer: <span className="text-foreground">{r.manufacturer ?? "—"}</span></div>
                    <div>Model: <span className="text-foreground">{r.model_or_unique_id ?? "—"}</span></div>
                    <div>Unit: <span className="text-foreground">{r.unit ?? "—"}</span></div>
                    <div>Required: <span className="text-foreground">{r.qty_required ?? "—"}</span></div>
                    <div>Available: <span className="text-foreground">{r.qty_available ?? "—"}</span></div>
                    <div>Short: <span className="text-foreground">{r.qty_short ?? "—"}</span></div>
                  </div>
                  {r.ocs_links.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">OCS:</span>
                      {r.ocs_links.map((l) => (
                        <Button
                          key={l.comment_id}
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[10px]"
                          onClick={() => onOpenOcs(l.comment_id)}
                        >
                          <Link2 className="h-3 w-3" /> {l.ocs_number ?? "OCS"} {l.sn ? `S/N ${l.sn}` : ""}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {r.source_sheet ?? "—"} / row {r.source_row ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <SplRspDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          item={editing}
          busy={m.upsertRsp.isPending}
          onSave={save}
        />
      </SheetContent>
    </Sheet>
  );
}
