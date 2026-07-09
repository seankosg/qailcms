import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { BulkEditableField } from "@/lib/spare-part/columns";
import { APPROVAL_CODES } from "@/lib/spare-part/columns";

interface Props {
  selectedDocRefs: string[];
  onClear: () => void;
  onSaved: () => void;
  canEdit: boolean;
}

const FIELD_LABELS: Record<BulkEditableField, string> = {
  remarks: "Remarks",
  action: "Action",
  proc_remarks: "Proc Remarks",
  is_active: "Active",
  is_duplicate: "DP",
  approval_code: "Approval Code",
  approval_status: "Approval Status",
  revision: "Revision",
};

const APPROVAL_FIELDS = new Set<BulkEditableField>(["approval_code", "approval_status", "revision"]);
const BOOLEAN_FIELDS = new Set<BulkEditableField>(["is_active", "is_duplicate"]);

export function BulkEditBar({ selectedDocRefs, onClear, onSaved, canEdit }: Props) {
  const [field, setField] = useState<BulkEditableField>("remarks");
  const [value, setValue] = useState<string>("");
  const [boolVal, setBoolVal] = useState<"true" | "false">("true");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  if (selectedDocRefs.length === 0) return null;

  const applyValue = async () => {
    if (!canEdit) {
      toast({ title: "권한 없음", description: "관리자 권한이 필요합니다.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (BOOLEAN_FIELDS.has(field)) payload[field] = boolVal === "true";
      else payload[field] = value === "" ? null : value;

      const { error } = await supabase
        .from("spare_parts_raw")
        .update(payload)
        .in("doc_ref", selectedDocRefs);
      if (error) throw error;
      toast({ title: "저장 완료", description: `${selectedDocRefs.length}개 행 업데이트` });
      setValue("");
      onSaved();
    } catch (e: any) {
      toast({ title: "저장 실패", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isApprovalField = APPROVAL_FIELDS.has(field);

  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t bg-background/95 px-3 py-2 backdrop-blur">
      <span className="text-xs font-medium">
        선택: <span className="tabular-nums">{selectedDocRefs.length}</span>
      </span>
      <Select value={field} onValueChange={(v) => setField(v as BulkEditableField)}>
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(FIELD_LABELS) as BulkEditableField[]).map((f) => (
            <SelectItem key={f} value={f} className="text-xs">
              {FIELD_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {BOOLEAN_FIELDS.has(field) ? (
        <Select value={boolVal} onValueChange={(v) => setBoolVal(v as any)}>
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      ) : field === "approval_code" ? (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-8 w-28">
            <SelectValue placeholder="Code" />
          </SelectTrigger>
          <SelectContent>
            {APPROVAL_CODES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field === "remarks" || field === "proc_remarks" ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-56 justify-start truncate">
              {value || "값 입력..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="start">
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} className="text-xs" />
          </PopoverContent>
        </Popover>
      ) : (
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-56 text-xs" placeholder="값 입력..." />
      )}

      {isApprovalField && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100/70 px-2 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" /> Aconex Sync 재실행 시 덮어써질 수 있음
        </span>
      )}

      <Button size="sm" className="h-8" onClick={applyValue} disabled={saving || !canEdit}>
        {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        Apply
      </Button>
      <Button variant="ghost" size="sm" className="h-8" onClick={onClear}>
        <X className="mr-1 h-3 w-3" />
        Clear selection
      </Button>
    </div>
  );
}