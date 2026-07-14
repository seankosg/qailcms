import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Pencil, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  validateSourceHeaderEdit,
  type HeaderMappingLike,
} from "@/lib/admin/header-mapping-validation";

interface Props {
  row: HeaderMappingLike & { is_custom?: boolean };
  rows: HeaderMappingLike[];
  activeTargetFields: Set<string>;
  onSave: (trimmed: string) => Promise<void>;
  canEdit?: boolean;
}

export function EditableSourceHeaderCell({ row, rows, activeTargetFields, onSave, canEdit = true }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.source_header);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(row.source_header);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, row.source_header]);

  const commit = async () => {
    const result = validateSourceHeaderEdit(rows, row.id, draft, activeTargetFields);
    if (!result.ok) {
      toast.error("저장 불가", { description: result.error });
      return;
    }
    if (result.noop) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.trimmed);
      result.warnings.forEach((w) => toast.warning("주의", { description: w }));
      toast.success("Source Header 저장됨");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group flex items-center gap-2">
        <span className="text-sm">{row.source_header}</span>
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={() => setEditing(true)}
            title="Source Header 수정"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  const isSystem = row.is_custom === false;

  return (
    <div className="space-y-1">
      {isSystem && (
        <div className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          <span>System 매핑입니다. 시드/재배포 시 값이 되돌아갈 수 있습니다.</span>
        </div>
      )}
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          disabled={saving}
          className="h-7 text-sm"
        />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void commit()} disabled={saving} title="저장">
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving} title="취소">
          <X className="h-3.5 w-3.5" />
        </Button>
        {draft.trim() !== row.source_header && draft.trim() && (
          <Badge variant="outline" className="text-[10px]">Enter로 저장</Badge>
        )}
      </div>
    </div>
  );
}