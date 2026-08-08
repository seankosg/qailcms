import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { rclCanRows } from "@/hooks/useRclCan";
import { WRT_EDITABLE_FIELDS } from "./wrt-columns";

interface Props {
  selectedIds: string[];
  /** 팀 드롭다운 후보 — 현재 로드된 행의 distinct */
  teamOptions: string[];
  onClear: () => void;
  onSaveField: (id: string, field: string, value: string | null) => Promise<void>;
  onDone: () => Promise<void> | void;
  disabledReason?: string | null;
}

export function WrtBulkEditBar({ selectedIds, teamOptions, onClear, onSaveField, onDone, disabledReason }: Props) {
  const [field, setField] = useState<string>("team");
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    if (selectedIds.length === 0) {
      setAllowed(null);
      return;
    }
    void rclCanRows("WRT", selectedIds, "write").then((s) => {
      if (live) setAllowed(selectedIds.filter((id) => s.has(id)));
    });
    return () => {
      live = false;
    };
  }, [selectedIds]);

  const excluded = allowed ? selectedIds.length - allowed.length : 0;
  const isTeam = field === "team";
  const options = useMemo(() => teamOptions.filter(Boolean), [teamOptions]);

  if (selectedIds.length === 0) return null;

  const apply = async () => {
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    const ids = allowed ?? [];
    if (ids.length === 0) {
      toast.error("No rows you are allowed to edit.");
      return;
    }
    setBusy(true);
    const v = value === "__null__" || value.trim() === "" ? null : value.trim();
    let ok = 0;
    const errs: string[] = [];
    for (const id of ids) {
      try {
        await onSaveField(id, field, v);
        ok += 1;
      } catch (e: any) {
        errs.push(e?.message ?? String(e));
      }
    }
    setBusy(false);
    await onDone();
    if (errs.length === 0) toast.success(`${ok} rows updated`);
    else toast.warning(`${ok} updated · ${errs.length} failed — ${errs[0]}`);
  };

  return (
    <div className="sticky bottom-2 z-30 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-lg">
      <span className="text-xs font-medium">
        {selectedIds.length.toLocaleString()} selected
        {allowed && (
          <span className="ml-1 text-[11px] text-muted-foreground">
            (editable {allowed.length} / not permitted {excluded})
          </span>
        )}
      </span>
      <Select value={field} onValueChange={(v) => { setField(v); setValue(""); }}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WRT_EDITABLE_FIELDS.map((f) => (
            <SelectItem key={f.field} value={f.field}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isTeam ? (
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Select team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__null__">(none)</SelectItem>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="New value (leave empty to clear)"
          className="h-8 w-48 text-xs"
        />
      )}
      <Button size="sm" className="h-8 text-xs" onClick={apply} disabled={busy || !!disabledReason}>
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Apply to selection
      </Button>
      {disabledReason && <span className="text-[11px] text-amber-600">{disabledReason}</span>}
      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClear}>
        <X className="mr-1 h-3 w-3" />
        선택 Clear
      </Button>
    </div>
  );
}