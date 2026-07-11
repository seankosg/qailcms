import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, Loader2 } from "lucide-react";
import { TM_COLUMNS } from "@/lib/task-management/columns";
import { buildStyledWorkbook, saveStyledWorkbook, type ColumnKind } from "@/lib/excel/styled-workbook";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";

type ExportFormat = "view" | "reimport";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: Record<string, unknown>[];
  visibleKeys: string[];
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function styledCols(
  keys: string[],
  format: ExportFormat,
  resolveLabel: (key: string) => string,
) {
  return keys.map((k) => {
    const def = TM_COLUMNS.find((c) => c.key === k);
    let kind: ColumnKind = "text";
    if (def) {
      if (def.type === "date") kind = "date";
      else if (def.type === "number" || def.type === "percent") kind = "number";
      else if (def.type === "boolean") kind = "boolean";
    }
    return {
      key: k,
      label: format === "reimport" ? k : resolveLabel(k),
      kind,
      widthPx: def?.width,
    };
  });
}

export function ExportDialog({ open, onOpenChange, rows, visibleKeys }: Props) {
  const [format, setFormat] = useState<ExportFormat>("view");
  const [busy, setBusy] = useState(false);
  const resolveLabel = useTmColumnLabel();

  const run = () => {
    setBusy(true);
    try {
      const keys = format === "reimport" ? TM_COLUMNS.map((c) => c.key) : visibleKeys;
      const wb = buildStyledWorkbook({
        title: `Task Management Raw Data  (${format === "reimport" ? "Re-import" : "View"})`,
        columns: styledCols(keys, format, resolveLabel),
        rows,
        sheetName: "Task Management",
        freezeCols: 1,
      });
      saveStyledWorkbook(wb, `task-management_${format}_${timestamp()}.xlsx`);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Task Raw Data</DialogTitle>
          <DialogDescription>
            현재 필터 결과{" "}
            <span className="font-medium tabular-nums">{rows.length.toLocaleString()}</span>행을
            내보냅니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Format</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              className="mt-2 flex flex-col gap-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="view" className="mt-1" />
                <span>View — 현재 표시 컬럼/라벨 그대로</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="reimport" className="mt-1" />
                <span>Re-import — 표준 필드(snake_case 헤더)</span>
              </label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={run} disabled={busy || rows.length === 0}>
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-1 h-3 w-3" />
            )}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}