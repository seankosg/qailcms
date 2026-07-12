import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkUpdateDefects } from "@/lib/defect-management/mutations.functions";
import { getDefectBulkEditableFields } from "@/lib/defect-management/columns";
import { toast } from "sonner";
import { X, Pencil } from "lucide-react";

interface Props {
  selectedIds: string[];
  onCleared: () => void;
  onApplied: () => void;
}

export function BulkEditBar({ selectedIds, onCleared, onApplied }: Props) {
  const [field, setField] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fields = getDefectBulkEditableFields();
  if (selectedIds.length === 0) return null;

  const cur = fields.find((f) => f.field === field);

  const apply = async () => {
    if (!field) return;
    setBusy(true);
    try {
      const patchValue = value === "" ? null : (cur?.inputType === "number" ? Number(value) : value);
      await bulkUpdateDefects({ data: { ids: selectedIds, patch: { [field]: patchValue } } });
      toast.success(`${cur?.label} 을(를) ${selectedIds.length}건에 일괄 적용`);
      setOpen(false);
      setField(""); setValue("");
      onApplied();
    } catch (e: any) {
      toast.error(`일괄편집 실패: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg border bg-background shadow-lg px-4 py-2 flex items-center gap-3">
      <span className="text-xs"><b>{selectedIds.length}</b>건 선택</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 text-xs"><Pencil className="mr-1 h-3 w-3" /> 일괄 편집</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2 p-3" align="end">
          <div className="text-[11px] font-medium text-muted-foreground">필드 선택</div>
          <Select value={field} onValueChange={setField}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="편집할 필드..." /></SelectTrigger>
            <SelectContent className="max-h-60">
              {fields.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {cur && (
            <>
              <div className="text-[11px] font-medium text-muted-foreground">값</div>
              {cur.inputType === "text" && <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
              {cur.inputType === "number" && <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
              {cur.inputType === "date" && <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
              {cur.inputType === "textarea" && <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="text-xs" />}
              {cur.inputType === "select" && (
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택..." /></SelectTrigger>
                  <SelectContent>{(cur.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <div className="flex justify-end pt-1">
                <Button size="sm" className="h-7 text-xs" onClick={apply} disabled={busy}>{busy ? "적용 중..." : "적용"}</Button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCleared}><X className="h-3 w-3" /></Button>
    </div>
  );
}