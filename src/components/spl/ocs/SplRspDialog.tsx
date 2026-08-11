import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SplRspItem } from "@/lib/spl/ocs.functions";

export type SplRspDraft = {
  id: string | null;
  description: string;
  manufacturer: string;
  model: string;
  unit: string;
  qtyRequired: string;
  qtyAvailable: string;
  qtyShort: string;
};

/** RSP 추가·수정 — rsp_number 는 서버 자동 채번(충돌 금지) */
export function SplRspDialog({
  open,
  onOpenChange,
  item,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: SplRspItem | null;
  busy: boolean;
  onSave: (d: SplRspDraft) => void;
}) {
  const [d, setD] = useState<SplRspDraft>({
    id: null,
    description: "",
    manufacturer: "",
    model: "",
    unit: "",
    qtyRequired: "",
    qtyAvailable: "",
    qtyShort: "",
  });

  useEffect(() => {
    if (!open) return;
    setD({
      id: item?.id ?? null,
      description: item?.description ?? "",
      manufacturer: item?.manufacturer ?? "",
      model: item?.model_or_unique_id ?? "",
      unit: item?.unit ?? "",
      qtyRequired: item?.qty_required?.toString() ?? "",
      qtyAvailable: item?.qty_available?.toString() ?? "",
      qtyShort: item?.qty_short?.toString() ?? "",
    });
  }, [open, item]);

  const set = (k: keyof SplRspDraft, v: string) => setD((p) => ({ ...p, [k]: v }));
  const field = (k: keyof SplRspDraft, label: string) => (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input className="h-8 text-xs" value={d[k] as string} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {item ? `Edit ${item.rsp_number}` : "Add RSP item"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="col-span-2">{field("description", "Description")}</div>
          {field("manufacturer", "Manufacturer")}
          {field("model", "Model Number")}
          {field("unit", "Unit")}
          {field("qtyRequired", "Required Qty")}
          {field("qtyAvailable", "Available Qty")}
          {field("qtyShort", "Short Qty")}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || d.description.trim().length === 0} onClick={() => onSave(d)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
