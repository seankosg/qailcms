import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Pencil } from "lucide-react";
import {
  clearDefectFieldLock,
  updateDefectField,
} from "@/lib/defect-management/mutations.functions";
import { toast } from "sonner";

export interface EditCellPopoverProps {
  id: string;
  field: string;
  label: string;
  editorType: "text" | "select" | "date" | "number" | "textarea";
  options?: string[];
  currentValue: any;
  locked?: boolean;
  /** 사용자가 직접 수정해 임포트 덮어쓰기로부터 보호 중인 자동채움 필드 */
  manualLocked?: boolean;
  canEdit?: boolean;
  onSaved?: (val: any) => void;
  children: React.ReactNode;
}

export function EditCellPopover({ id, field, label, editorType, options, currentValue, locked, manualLocked, canEdit = true, onSaved, children }: EditCellPopoverProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<any>(currentValue ?? "");
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span title="편집 권한이 없습니다" className="inline-flex items-center gap-1">
        {children}
      </span>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      const raw = value === "__null__" ? "" : value;
      const nextVal = raw === "" ? null : editorType === "number" ? Number(raw) : raw;
      await updateDefectField({ data: { id, field, value: nextVal } });
      toast.success(`${label} 저장됨`);
      onSaved?.(nextVal);
      setOpen(false);
    } catch (e: any) {
      toast.error(`저장 실패: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      await clearDefectFieldLock({ data: { id, field } });
      toast.success(`${label} 잠금 해제됨 · 다음 임포트에서 자동값으로 갱신됩니다`);
      onSaved?.(currentValue);
      setOpen(false);
    } catch (e: any) {
      toast.error(`잠금 해제 실패: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (locked) { toast.info("잠긴 필드입니다. 잠금 해제 후 편집하세요."); return; } setOpen(o); if (o) setValue(currentValue ?? ""); }}>
      <PopoverTrigger asChild>
        <span
          className="group inline-flex items-center gap-1 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
          title={
            locked
              ? "잠긴 필드 · 잠금 해제 필요"
              : manualLocked
                ? "수동 수정값 · 임포트 시 보존됨 (클릭하여 편집)"
                : "클릭하여 편집"
          }
        >
          {children}
          {manualLocked && !locked && (
            <Lock className="h-2.5 w-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          {!locked && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        {manualLocked && (
          <div className="rounded-md bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            수동 수정값으로 보호 중 · 임포트/자동 분류가 덮어쓰지 않습니다.
          </div>
        )}
        {editorType === "text" && <Input value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "number" && <Input type="number" value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "date" && <Input type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />}
        {editorType === "textarea" && <Textarea value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} rows={4} className="text-xs" />}
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
          {manualLocked && (
            <Button
              size="sm"
              variant="outline"
              className="mr-auto h-7 text-xs"
              onClick={unlock}
              disabled={busy}
            >
              자동값으로 되돌리기
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)} disabled={busy}>취소</Button>
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={busy}>{busy ? "저장 중..." : "저장"}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}