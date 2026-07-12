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
import { TM_COLUMNS, TM_GANTT_ORIGINAL_ORDER } from "@/lib/task-management/columns";
import {
  buildStyledWorkbook,
  saveStyledWorkbook,
  type ColumnKind,
  type ColumnGroupTag,
} from "@/lib/excel/styled-workbook";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";
// -- Column → Gantt group mapping (matches upload template Gantt sheet) ------
const GROUP_BY_KEY: Record<string, ColumnGroupTag> = {
  __sno: "basic",
  plan_start: "plan",
  plan_end: "plan",
  plan_days: "plan",
  actual_start: "actual",
  actual_finish: "actual",
  actual_duration: "actual",
  actual_progress: "actual",
  forecast_end: "progress",
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
  // 원본 템플릿과 동일한 yyyy-mm-dd 날짜 표기
  plan_start: "yyyy-mm-dd",
  plan_end: "yyyy-mm-dd",
  actual_start: "yyyy-mm-dd",
  actual_finish: "yyyy-mm-dd",
  forecast_end: "yyyy-mm-dd",
  data_date: "yyyy-mm-dd",
  actual_progress: "0.0%",
  plan_progress: "0.0%",
  expected_progress_today: "0%",
  progress_variance: "+0.0%;-0.0%;0.0%",
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
  const endActual = dates[dates.length - 1];
  const startMs = Date.parse(start + "T00:00:00Z");
  const endActualMs = Date.parse(endActual + "T00:00:00Z");
  if (!Number.isFinite(startMs) || !Number.isFinite(endActualMs)) return null;
  // 원본 템플릿 기본 153일. 데이터가 더 짧으면 최소 153일 확보, 더 길면 730일 캡.
  const DEFAULT_DAYS = 153;
  const MAX_DAYS = 730;
  const actualDays = Math.round((endActualMs - startMs) / 86400000);
  const days = Math.min(MAX_DAYS, Math.max(DEFAULT_DAYS, actualDays));
  const capped = new Date(startMs + days * 86400000).toISOString().slice(0, 10);
  return { startDate: start, endDate: capped };
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

/**
 * 원본 xlsx `Gantt` 시트 A..T 순서를 재현하는 컬럼 스펙.
 * View 모드에서만 사용 — user visibility와 무관하게 원본 순서/한글 라벨을 강제.
 */
function ganttOriginalCols() {
  return TM_GANTT_ORIGINAL_ORDER.map((c) => {
    const def = c.key ? TM_COLUMNS.find((d) => d.key === c.key) : undefined;
    let kind: ColumnKind = "text";
    if (def) {
      if (def.type === "date") kind = "date";
      else if (def.type === "number" || def.type === "percent") kind = "number";
      else if (def.type === "boolean") kind = "boolean";
    }
    // 원본 컬럼별 너비 (엑셀 wch → 대략적인 px 환산: wch * 7)
    const WIDTHS_WCH: Record<string, number> = {
      A: 5, B: 9, C: 15, D: 6, E: 37, F: 9, G: 34, H: 13, I: 7, J: 8,
      K: 10, L: 11, M: 5, N: 11, O: 7, P: 8, Q: 9, R: 9, S: 6, T: 11,
    };
    const widthPx = (WIDTHS_WCH[c.letter] ?? 10) * 7;
    return {
      key: c.key ?? `__blank_${c.letter}`,
      label: c.label,
      kind,
      widthPx,
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
      const isView = format === "view";
      const keys = format === "reimport" ? TM_COLUMNS.map((c) => c.key) : visibleKeys;
      const dataDateIso = new Date().toISOString().slice(0, 10);
      const ganttRange = isView ? computeGanttRange(rows, dataDateIso) : null;

      // View 모드: 원본 A열(Sno) 자동 순번 주입
      const exportRows = isView
        ? rows.map((r, i) => ({ ...r, __sno: i + 1 }))
        : rows;

      // View: 원본 A..T 순서 강제. 프리즈는 I열(상태)까지 = 9.
      // Re-import: 첫 컬럼만.
      const viewCols = ganttOriginalCols();
      const freezeCols = isView ? 9 : 1;

      const wb = buildStyledWorkbook({
        title: `Task Management Raw Data  (${format === "reimport" ? "Re-import" : "View"})`,
        columns: isView ? viewCols : styledCols(keys, format, resolveLabel),
        rows: exportRows,
        sheetName: isView ? "Gantt" : "Task Management",
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