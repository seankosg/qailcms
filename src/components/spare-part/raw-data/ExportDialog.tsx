import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, Loader2 } from "lucide-react";
import { exportGrouped, exportSingle, type ExportFormat, type ExportGroupBy } from "@/lib/spare-part/excel-export";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: Record<string, unknown>[];
  visibleKeys: string[];
}

export function ExportDialog({ open, onOpenChange, rows, visibleKeys }: Props) {
  const [mode, setMode] = useState<"single" | "grouped">("single");
  const [groupBy, setGroupBy] = useState<ExportGroupBy>("plot");
  const [format, setFormat] = useState<ExportFormat>("view");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      if (mode === "single") exportSingle(rows, visibleKeys, format);
      else await exportGrouped(rows, visibleKeys, format, groupBy);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Raw Data</DialogTitle>
          <DialogDescription>
            현재 필터 결과 <span className="font-medium tabular-nums">{rows.length.toLocaleString()}</span>행을 내보냅니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="single" /> Single file
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="grouped" /> Per group
              </label>
            </RadioGroup>
          </div>

          {mode === "grouped" && (
            <div>
              <Label className="text-xs">Group by</Label>
              <RadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as ExportGroupBy)} className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="plot" /> Plot
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="supplier" /> Supplier
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="manufacturer" /> Manufacturer
                </label>
              </RadioGroup>
              <p className="mt-1 text-[11px] text-muted-foreground">그룹이 7개 이상이면 ZIP으로 묶어 다운로드됩니다.</p>
            </div>
          )}

          <div>
            <Label className="text-xs">Format</Label>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="view" className="mt-1" />
                <span>
                  View — 현재 표시 컬럼/라벨 그대로
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="reimport" className="mt-1" />
                <span>
                  Re-import — 46 표준 필드(snake_case 헤더)
                </span>
              </label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={run} disabled={busy || rows.length === 0}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}