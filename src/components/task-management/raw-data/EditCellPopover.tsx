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
import { WorkTypeCombo } from "./WorkTypeCombo";

interface Props {
  rowId: string;
  column: TmColumnDef;
  currentValue: unknown;
  canEdit: boolean;
  onSaved: () => void;
  children: React.ReactNode;
  /** 커스텀 저장 경로 (제공 시 supabase 직접 update 대신 호출됨) */
  onSave?: (value: unknown) => Promise<void>;
  /** 저장 성공 시 로컬 캐시 부분 패치 (제공 시 페이지 refetch 대체) */
  onLocalPatch?: (value: unknown) => void;
}

export function EditCellPopover({
  rowId,
  column,
  currentValue,
  canEdit,
  onSaved,
  children,
  onSave,
  onLocalPatch,
}: Props) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(
    currentValue == null ? "" : String(currentValue),
  );
  const [busy, setBusy] = useState(false);
  const resolveLabel = useTmColumnLabel();
  const displayLabel = resolveLabel(column.key);

  if (!column.editable || !canEdit) return <>{children}</>;

  const isPercent = column.type === "percent";
  // percent 컬럼은 UI 는 0~100 (% 단위), DB 는 0~1 (fraction) 로 저장.
  const toDisplay = (v: unknown): string => {
    if (v == null || v === "") return "";
    if (isPercent) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "";
      return String(Math.round(n * 1000) / 10);
    }
    return String(v);
  };

  async function save() {
    setBusy(true);
    try {
      // Radix Select는 빈 문자열 value 를 금지하므로 "__BLANK__" 를 null 센티널로 사용
      let payload: unknown = val === "" || val === "__BLANK__" ? null : val;
      if (isPercent && payload != null) {
        const n = Number(val);
        if (!Number.isFinite(n)) {
          toast.error("숫자를 입력해주세요");
          setBusy(false);
          return;
        }
        if (n < 0 || n > 100) {
          toast.error("0 ~ 100 사이의 % 값을 입력해주세요");
          setBusy(false);
          return;
        }
        payload = Math.round((n / 100) * 10000) / 10000;
      } else if (column.editorType === "number" && payload != null) {
        const n = Number(val);
        payload = Number.isFinite(n) ? n : null;
      }
      if (onSave) {
        await onSave(payload);
      } else {
        const { error } = await (supabase as any)
          .from("task_management_raw")
          .update({ [column.key]: payload })
          .eq("id", rowId);
        if (error) throw error;
      }
      toast.success("저장 완료", { description: displayLabel });
      setOpen(false);
      if (onLocalPatch) onLocalPatch(payload);
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
          setVal(toDisplay(currentValue));
      }}
    >
      <PopoverTrigger asChild>
        <span
          className="flex w-full cursor-pointer items-center rounded hover:bg-accent/50"
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
        {column.editorType === "select" && column.key === "row_type" && (
          <WorkTypeCombo
            value={val === "__BLANK__" ? "" : val}
            onChange={(v) => setVal(v)}
            className="h-8 text-xs"
          />
        )}
        {column.editorType === "select" && column.key !== "row_type" && (
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__BLANK__">(Blank)</SelectItem>
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
          isPercent ? (
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                step="0.1"
                className="h-8 pr-6 text-xs"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="0 ~ 100"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground">
                %
              </span>
            </div>
          ) : (
            <Input
              type="number"
              step="0.0001"
              className="h-8 text-xs"
              value={val}
              onChange={(e) => setVal(e.target.value)}
            />
          )
        )}
        {isPercent && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            % 값을 입력하세요 (예: 30 → 30%)
          </p>
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