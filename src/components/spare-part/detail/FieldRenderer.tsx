import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { SparePartColumnDef } from "@/lib/spare-part/columns";
import { APPROVAL_CODES } from "@/lib/spare-part/columns";

const TEXTAREA_KEYS = new Set([
  "subject",
  "remarks",
  "action",
  "proc_remarks",
  "physical_remarks",
  "doc_others",
  "approval_status",
]);

interface Props {
  col: SparePartColumnDef;
  label: string;
  value: unknown;
  disabled?: boolean;
  onChange: (v: unknown) => void;
}

export function FieldRenderer({ col, label, value, disabled, onChange }: Props) {
  const id = `field-${col.key}`;

  const renderControl = () => {
    if (col.type === "boolean") {
      return (
        <div className="flex items-center h-9">
          <Switch
            id={id}
            checked={!!value}
            onCheckedChange={(v) => onChange(v)}
            disabled={disabled}
          />
          <span className="ml-2 text-xs text-muted-foreground">{value ? "Yes" : "No"}</span>
        </div>
      );
    }
    if (col.type === "date") {
      const v = typeof value === "string" ? value.slice(0, 10) : "";
      return (
        <Input
          id={id}
          type="date"
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    }
    if (col.type === "number" || col.type === "cost" || col.type === "progress") {
      return (
        <Input
          id={id}
          type="number"
          step="any"
          min={col.type === "progress" ? 0 : undefined}
          max={col.type === "progress" ? 100 : undefined}
          value={value == null ? "" : String(value)}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
        />
      );
    }
    if (col.type === "badge" && col.key === "approval_code") {
      return (
        <Select
          value={(value as string) ?? "__none"}
          onValueChange={(v) => onChange(v === "__none" ? null : v)}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {APPROVAL_CODES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (col.type === "badge" && col.key === "plot") {
      return (
        <Select
          value={(value as string) ?? "__none"}
          onValueChange={(v) => onChange(v === "__none" ? null : v)}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            <SelectItem value="C">C</SelectItem>
            <SelectItem value="D">D</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (TEXTAREA_KEYS.has(col.key)) {
      return (
        <Textarea
          id={id}
          value={(value as string) ?? ""}
          rows={2}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    }
    return (
      <Input
        id={id}
        value={(value as string) ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {renderControl()}
    </div>
  );
}