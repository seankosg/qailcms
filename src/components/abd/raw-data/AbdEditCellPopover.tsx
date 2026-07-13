import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil } from "lucide-react";
import { updateAbdField } from "@/lib/abd/mutations.functions";
import { toast } from "sonner";

export interface AbdEditCellPopoverProps {
  id: string;
  field: string;
  label: string;
  editorType: "text" | "select" | "date" | "number";
  options?: string[];
  currentValue: any;
  canEdit?: boolean;
  onSaved?: (val: any) => void;
  children: React.ReactNode;
}

export function AbdEditCellPopover({ id, field, label, editorType, options, currentValue, canEdit = true, onSaved, children }: AbdEditCellPopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<any>(currentValue ?? "");
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <span title="관리자만 편집 가능" className="inline-flex items-center gap-1">{children}</span>;
  }

  const save = async () => {
    setBusy(true);
    try {
      const raw = value === "__null__" ? "" : value;
      const nextVal = raw === "" ? null : editorType === "number" ? Number(raw) : raw;
      await updateAbdField({ data: { id, field, value: nextVal } });
      toast.success(`${label} 저장됨`);
      onSaved?.(nextVal);
      setOpen(false);
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(currentValue ?? ""); }}>
      <PopoverTrigger asChild>
        <span className="group inline-flex items-center gap-1 cursor-pointer" onClick={(e) => e.stopPropagation()} title="클릭하여 편집">
          {children}
          <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        {editorType === "text" && <Input value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "number" && <Input type="number" value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "date" && <Input type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "select" && (
          <Select value={String(value ?? "")} onValueChange={setValue}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__null__">(비우기)</SelectItem>
              {(options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={busy}>{busy ? "저장 중..." : "저장"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}