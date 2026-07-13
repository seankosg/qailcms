import { Button } from "@/components/ui/button";
import type { Dispatch, SetStateAction } from "react";

interface Props {
  isAdmin: boolean;
  selectedRows: Array<{ id: string; is_critical?: boolean | null }>;
  pending: Map<string, boolean>;
  setPending: Dispatch<SetStateAction<Map<string, boolean>>>;
}

export function CriticalBulkBar({ isAdmin, selectedRows, pending, setPending }: Props) {
  if (!isAdmin || selectedRows.length === 0) return null;

  const setSelected = (value: boolean) => {
    setPending((prev) => {
      const next = new Map(prev);
      for (const row of selectedRows) {
        const original = !!row.is_critical;
        if (original === value) next.delete(row.id);
        else next.set(row.id, value);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">Critical bulk</span>
      <span className="text-muted-foreground">{selectedRows.length} selected · {pending.size} pending</span>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelected(true)}>Mark critical</Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelected(false)}>Unmark</Button>
    </div>
  );
}