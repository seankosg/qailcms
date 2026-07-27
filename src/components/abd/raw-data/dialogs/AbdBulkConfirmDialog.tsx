import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { BulkEditableField } from "@/lib/abd/bulk-actions";

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

export function AbdBulkConfirmDialog({
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Edit 확인</DialogTitle>
          <DialogDescription>
            {totalCount}개 행의 <code>{field?.label}</code> 값을{" "}
            <strong>{fmt(value)}</strong>로 변경합니다. ({chunkCount} batch)
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded border text-xs">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-2 py-1 text-left">ABD Number</th>
                <th className="px-2 py-1 text-left">Before</th>
                <th className="px-2 py-1 text-left">After</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1 font-mono">{fmt(r.abd_number)}</td>
                  <td className="px-2 py-1">
                    {fmt(field ? r[field.field] : "")}
                  </td>
                  <td className="px-2 py-1 font-medium">{fmt(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 5 && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              …외 {rows.length - 5}개
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            취소
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}