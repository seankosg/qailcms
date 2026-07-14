import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  validateTargetFieldEdit,
  type HeaderMappingLike,
} from "@/lib/admin/header-mapping-validation";

interface FieldOption {
  field_name: string;
  display_name: string;
}

interface Props {
  row: HeaderMappingLike;
  rows: HeaderMappingLike[];
  fields: FieldOption[];
  activeTargetFields: Set<string>;
  onSave: (next: string) => Promise<void>;
  canEdit?: boolean;
}

export function EditableTargetFieldCell({
  row,
  rows,
  fields,
  activeTargetFields,
  onSave,
  canEdit = true,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(row.target_field);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const result = validateTargetFieldEdit(rows, row.id, draft, activeTargetFields);
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
      await onSave(result.next);
      result.warnings.forEach((w) => toast.warning("주의", { description: w }));
      toast.success("Target Field 저장됨");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group flex items-center gap-2">
        <span className="font-mono text-xs">{row.target_field}</span>
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={() => {
              setDraft(row.target_field);
              setEditing(true);
            }}
            title="Target Field 수정"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={draft} onValueChange={setDraft} disabled={saving}>
        <SelectTrigger className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {fields.map((f) => (
            <SelectItem key={f.field_name} value={f.field_name}>
              <span className="font-mono text-xs mr-2">{f.field_name}</span>
              <span className="text-muted-foreground">— {f.display_name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void commit()} disabled={saving} title="저장">
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving} title="취소">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}