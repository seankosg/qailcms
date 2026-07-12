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
import {
  buildStyledWorkbook,
  saveStyledWorkbook,
  type ColumnKind,
  type ColumnGroupTag,
} from "@/lib/excel/styled-workbook";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";
// -- Column → Gantt group mapping (matches upload template Gantt sheet) ------
const GROUP_BY_KEY: Record<string, ColumnGroupTag> = {
  plan_start: "plan",
  plan_end: "plan",
  plan_days: "plan",
  actual_start: "actual",
  actual_finish: "actual",
  actual_duration: "actual",
  actual_progress: "actual",
  forecast_end: "actual",
  plan_progress: "progress",
  progress_variance: "progress",
  expected_progress_today: "progress",
  today_gap: "progress",
  slip_days: "progress",
  auto_judgment: "progress",
};
function ganttGroup(key: string): ColumnGroupTag {
  return GROUP_BY_KEY[key] ?? "basic";
}

const NUMFMT_BY_KEY: Record<string, string> = {
  plan_start: "mm-dd-yy",
  plan_end: "mm-dd-yy",
  actual_start: "mm-dd-yy",
  actual_finish: "mm-dd-yy",
  forecast_end: "mm-dd-yy",
  data_date: "mm-dd-yy",
  actual_progress: "0.0%",
  plan_progress: "0%",
  expected_progress_today: "0%",
  progress_variance: "+0%;-0%;0%",
  today_gap: "+0%;-0%;0%",
  plan_days: "0;-0;-",
  actual_duration: "0;-0;-",
  slip_days: "+0;-0;-",
};

function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 2000 || y > 2100) return null;
  return m[0];
}

function computeGanttRange(rows: Record<string, unknown>[], dataDateIso: string) {
  const dates: string[] = [];
  for (const r of rows) {
    for (const k of ["plan_start", "plan_end", "actual_start", "actual_finish", "forecast_end"]) {
      const iso = toIso(r[k]);
      if (iso) dates.push(iso);
    }
  }
  if (dates.length === 0) return null;
  dates.push(dataDateIso);
  dates.sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  // Cap total span at 2 years (~730 days) to protect the workbook builder.
  const startMs = Date.parse(start + "T00:00:00Z");
  const endMs = Date.parse(end + "T00:00:00Z");
  const days = Math.round((endMs - startMs) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days > 730) {
    const capped = new Date(startMs + 730 * 86400000).toISOString().slice(0, 10);
    return { startDate: start, endDate: capped };
  }
  return { startDate: start, endDate: end };
}

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

  const run = async () => {
    setBusy(true);
    try {
      const keys = format === "reimport" ? TM_COLUMNS.map((c) => c.key) : visibleKeys;
      const isView = format === "view";
      const dataDateIso = new Date().toISOString().slice(0, 10);
      const ganttRange = isView ? computeGanttRange(rows, dataDateIso) : null;

      // Freeze after "status_manual" (or last visible column ≤ that index)
      const freezeCols = isView
        ? Math.min(keys.length, Math.max(1, keys.indexOf("status_manual") + 1 || 12))
        : 1;

      const wb = buildStyledWorkbook({
        title: `Task Management Raw Data  (${format === "reimport" ? "Re-import" : "View"})`,
        columns: styledCols(keys, format, resolveLabel),
        rows,
        sheetName: "Task Management",
        freezeCols,
        theme: isView ? "gantt" : "default",
        columnGroup: isView ? ganttGroup : undefined,
        dataDate: isView ? dataDateIso : undefined,
        numFmtByKey: isView ? NUMFMT_BY_KEY : undefined,
        cellFillOverride: isView
          ? (key, value) => (key === "risk" && value === "High" ? "FFED7D31" : null)
          : undefined,
        rowStyleOverride: isView
          ? (row) =>
              row["level"] === "parent"
                ? { fillRgb: "FF305496", fontColorRgb: "FFFFFFFF", bold: true }
                : null
          : undefined,
        gantt:
          isView && ganttRange
            ? {
                startDate: ganttRange.startDate,
                endDate: ganttRange.endDate,
                rowDates: (row) => {
                  const ap = Number(row["actual_progress"] ?? 0);
                  return {
                    planStart: toIso(row["plan_start"]),
                    planEnd: toIso(row["plan_end"]),
                    actualStart: toIso(row["actual_start"]),
                    actualFinish: toIso(row["actual_finish"]),
                    forecastEnd: toIso(row["forecast_end"]),
                    done: Number.isFinite(ap) && ap >= 1,
                  };
                },
              }
            : undefined,
        formulaMode: isView ? "template" : undefined,
        settingsSheet: isView ? { alarmThreshold: -0.05 } : undefined,
      });
      await saveStyledWorkbook(wb, `task-management_${format}_${timestamp()}.xlsx`);
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