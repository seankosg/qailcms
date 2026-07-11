import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { TmColumnDef } from "@/lib/task-management/columns";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";

interface Props {
  rowId: string;
  column: TmColumnDef;
  currentValue: unknown;
  canEdit: boolean;
  onSaved: () => void;
  children: React.ReactNode;
}

export function EditCellPopover({
  rowId,
  column,
  currentValue,
  canEdit,
  onSaved,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(
    currentValue == null ? "" : String(currentValue),
  );
  const [busy, setBusy] = useState(false);
  const resolveLabel = useTmColumnLabel();
  const displayLabel = resolveLabel(column.key);

  if (!column.editable || !canEdit) return <>{children}</>;

  async function save() {
    setBusy(true);
    try {
      let payload: unknown = val === "" ? null : val;
      if (column.editorType === "number" && payload != null) {
        const n = Number(val);
        payload = Number.isFinite(n) ? n : null;
      }
      const { error } = await (supabase as any)
        .from("task_management_raw")
        .update({ [column.key]: payload })
        .eq("id", rowId);
      if (error) throw error;
      toast.success("저장 완료", { description: displayLabel });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error("저장 실패", { description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v)
          setVal(currentValue == null ? "" : String(currentValue));
      }}
    >
      <PopoverTrigger asChild>
        <span
          className="cursor-pointer rounded hover:bg-accent/50"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
          {displayLabel} 편집
        </p>
        {column.editorType === "select" && (
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">(Blank)</SelectItem>
              {(column.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {column.editorType === "date" && (
          <Input
            type="date"
            className="h-8 text-xs"
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
        )}
        {column.editorType === "number" && (
          <Input
            type="number"
            step="0.0001"
            className="h-8 text-xs"
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
        )}
        {column.editorType === "text" && (
          <Input
            className="h-8 text-xs"
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
        )}
        <div className="mt-2 flex justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            취소
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}저장
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}