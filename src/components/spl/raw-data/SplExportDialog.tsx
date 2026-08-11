import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { dohaStampCompact } from "@/lib/time/doha";
import { exportRowsToXlsx, copyRowsAsTsv } from "@/lib/abd/bulk-actions";
import type { SplRow } from "@/lib/spl/rows.functions";
import { SPL_COLUMNS } from "./spl-columns";

type Format = "view" | "roundtrip";
type Axis = "none" | "team" | "plot" | "dis";

const AXIS_LABEL: Record<Exclude<Axis, "none">, string> = { team: "Team", plot: "Plot", dis: "DIS" };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 현재 필터 결과 */
  rows: SplRow[];
  /** 화면 표시 컬럼 순서 */
  exportColumns: { key: string; label: string }[];
  /** 컬럼 키 → 내보내기 값 (스테이지 날짜는 재임포트 가능한 ISO) */
  valueOf?: (row: SplRow, key: string) => string;
  /** 왕복 임포트 양식 — 기존 경로 그대로 */
  onRoundtrip: () => Promise<void>;
}

function ts() {
  const s = dohaStampCompact();
  return `${s.slice(0, 8)}_${s.slice(8)}`;
}

export function SplExportDialog({ open, onOpenChange, rows, exportColumns, valueOf, onRoundtrip }: Props) {
  const [format, setFormat] = useState<Format>("view");
  const [axis, setAxis] = useState<Axis>("none");
  const [busy, setBusy] = useState(false);

  const getByKey = new Map(SPL_COLUMNS.map((c) => [c.key, c] as const));
  const toRecord = (r: SplRow) => {
    const out: Record<string, unknown> = {};
    for (const c of exportColumns) out[c.key] = valueOf ? valueOf(r, c.key) : (getByKey.get(c.key)?.get(r) ?? "");
    return out;
  };

  const run = async () => {
    setBusy(true);
    try {
      if (format === "roundtrip") {
        await onRoundtrip();
        onOpenChange(false);
        return;
      }
      if (rows.length === 0) {
        toast.error("No rows to export.");
        return;
      }
      const stamp = ts();
      if (axis === "none") {
        exportRowsToXlsx({ rows: rows.map(toRecord), columns: exportColumns, fileName: `CMS_SPL_view_${stamp}.xlsx` });
        toast.success(`Exported ${rows.length.toLocaleString()} rows`);
      } else {
        const groups = new Map<string, SplRow[]>();
        for (const r of rows) {
          const raw = (r as any)[axis];
          const key = raw != null && String(raw).trim() ? String(raw).trim() : "Unassigned";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        }
        for (const [key, rs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          exportRowsToXlsx({
            rows: rs.map(toRecord),
            columns: exportColumns,
            fileName: `CMS_SPL_view_${axis}-${key.replace(/[\\/:*?"<>|]/g, "_")}_${stamp}.xlsx`,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
        toast.success(`Downloaded ${groups.size} files`);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const res = await copyRowsAsTsv({ rows: rows.map(toRecord), columns: exportColumns });
    toast.success(`Copied ${res.rowCount} rows × ${res.colCount} columns`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export SPL Raw Data</DialogTitle>
          <DialogDescription>
            Exports <span className="font-medium tabular-nums">{rows.length.toLocaleString()}</span> rows from the current filter result.
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            View 파일은 그대로 다시 임포트할 수 있습니다. 단계 날짜는 ISO(YYYY-MM-DD)로 내보내며, Plot·Team·PIC/ENG·Supplier·단계 날짜만 반영됩니다.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as Format)} className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="view" className="mt-1" />
                <span>View (as displayed)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="roundtrip" className="mt-1" />
                <span>HDEC format (re-importable)</span>
              </label>
            </RadioGroup>
          </div>
          {format === "view" && (
            <div>
              <Label className="text-xs">Output</Label>
              <RadioGroup value={axis} onValueChange={(v) => setAxis(v as Axis)} className="mt-2 flex flex-col gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="none" className="mt-1" />
                  <span>Single file</span>
                </label>
                {(Object.keys(AXIS_LABEL) as Array<keyof typeof AXIS_LABEL>).map((a) => (
                  <label key={a} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value={a} className="mt-1" />
                    <span>Split by {AXIS_LABEL[a]}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={copy} disabled={busy || rows.length === 0}>
            Copy TSV
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}