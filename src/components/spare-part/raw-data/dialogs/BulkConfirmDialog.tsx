import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { BulkEditableField } from "@/lib/spare-part/bulk-edit";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  field: BulkEditableField | null;
  value: string | number | boolean | null;
  rows: Record<string, unknown>[];
  submitting: boolean;
  onConfirm: () => void;
  totalCount: number;
  chunkCount: number;
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function BulkConfirmDialog({
  open,
  onOpenChange,
  field,
  value,
  rows,
  submitting,
  onConfirm,
  totalCount,
  chunkCount,
}: Props) {
  const preview = rows.slice(0, 5);
  const displayNext = value === null ? "(Blank)" : fmt(value);

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg border-l-2 border-l-primary">
        <DialogHeader>
          <DialogTitle>Confirm bulk edit</DialogTitle>
          <DialogDescription>
            Setting <span className="font-medium text-foreground">{field?.label}</span> on{" "}
            <span className="font-medium text-foreground">{totalCount}</span> row
            {totalCount === 1 ? "" : "s"}
            {chunkCount > 1 ? ` in ${chunkCount} batches` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview (first {preview.length} of {totalCount})
            </div>
            <div className="max-h-56 overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Doc Ref</th>
                    <th className="px-2 py-1 text-left font-medium">Before</th>
                    <th className="px-2 py-1 text-left font-medium">After</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="truncate px-2 py-1 font-mono text-[11px]">
                        {String(r.doc_ref ?? "")}
                      </td>
                      <td className="truncate px-2 py-1 text-muted-foreground">
                        {fmt(field ? r[field.field] : "")}
                      </td>
                      <td className="truncate px-2 py-1 font-medium">{displayNext}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting || !field}>
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Apply to {totalCount} row{totalCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}