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
import { streamXlsxExport } from "@/lib/excel/stream-export";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";

type ExportFormat = "view" | "reimport";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: Record<string, unknown>[];
  visibleKeys: string[];
}

import { dohaStampCompact, dohaDateTime } from "@/lib/time/doha";
function timestamp() {
  // Doha (Asia/Qatar) — YYYYMMDD_HHmm
  const s = dohaStampCompact(); // YYYYMMDDHHmm
  return `${s.slice(0, 8)}_${s.slice(8)}`;
}

// 자동판정/색상용 정적 numFmt (수식 없음 — 값은 이미 서버에서 계산됨)
const NUMFMT_BY_KEY: Record<string, string> = {
  plan_start: "yyyy-mm-dd",
  plan_end: "yyyy-mm-dd",
  actual_start: "yyyy-mm-dd",
  actual_finish: "yyyy-mm-dd",
  forecast_end: "yyyy-mm-dd",
  data_date: "yyyy-mm-dd",
  actual_progress: "0.0%",
  plan_progress: "0.0%",
  progress_variance: "+0.0%;-0.0%;0.0%",
  plan_days: "0;-0;-",
  actual_duration: "0;-0;-",
  slip_days: "+0;-0;-",
};

// 자동판정 값별 정적 fill (ARGB)
const JUDGMENT_FILL: Record<string, string> = {
  Delayed: "FFFFC7CE",       // 지연 — 빨강
  "At Risk": "FFFFE699",     // 위험 — 노랑
  "On Track": "FFC6EFCE",    // 정상 — 초록
  Completed: "FFD9E1F2",     // 완료 — 파랑
};

export function ExportDialog({ open, onOpenChange, rows, visibleKeys }: Props) {
  const [format, setFormat] = useState<ExportFormat>("view");
  const [busy, setBusy] = useState(false);
  const resolveLabel = useTmColumnLabel();

  const run = async () => {
    setBusy(true);
    try {
      const isView = format === "view";
      const keys = isView ? visibleKeys : TM_COLUMNS.map((c) => c.key);

      const columns = keys.map((k) => ({
        key: k,
        label: isView ? resolveLabel(k) : k,
      }));

      const columnWidths: Record<string, number> = {};
      for (const k of keys) {
        const def = TM_COLUMNS.find((c) => c.key === k);
        columnWidths[k] = def?.width ? Math.max(8, Math.min(60, Math.round(def.width / 7))) : 18;
      }

      const dateFields = TM_COLUMNS.filter((c) => c.type === "date").map((c) => c.key);

      const exportedTs = dohaDateTime();

      const rowsSnapshot = rows;
      await streamXlsxExport({
        filename: `task-management_${format}_${timestamp()}.xlsx`,
        sheetName: "Task Management",
        columns,
        columnWidths,
        dateFields,
        numFmtByKey: NUMFMT_BY_KEY,
        header: {
          title: `Task Management Raw Data  (${isView ? "View" : "Re-import"})`,
          metaRows: [
            `Exported: ${exportedTs}`,
            `Rows: ${rows.length.toLocaleString()}   Columns: ${columns.length}`,
            "",
            "",
            "",
          ],
          freezeCols: isView ? 3 : 1,
        },
        cellFillFor: (key, value) => {
          if (key === "auto_judgment" && typeof value === "string") {
            return JUDGMENT_FILL[value] ?? null;
          }
          if (key === "risk" && value === "High") return "FFED7D31";
          return null;
        },
        rowFillFor: (row) => {
          const j = row["auto_judgment"];
          if (j === "Delayed") return "FFFDECEA";
          return null;
        },
        fetchPage: async (offset) => {
          if (offset >= rowsSnapshot.length) return { rows: [], total: rowsSnapshot.length };
          const slice = rowsSnapshot.slice(offset, offset + 1000);
          return { rows: slice as Record<string, unknown>[], total: rowsSnapshot.length };
        },
      });
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
          <p className="text-xs text-muted-foreground">
            Gantt 캘린더/파생 수식은 폐기되어 값은 정적으로 기록됩니다. 지연/위험 행은 셀 배경색으로 표시됩니다.
          </p>
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