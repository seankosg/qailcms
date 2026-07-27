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
import {
  computeVariance,
  computeDailyPlan,
  computeDailyDiff,
} from "@/lib/task-management/derived";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ExportFormat = "view" | "reimport";
type SplitAxis = "none" | "team" | "hdec_pic_name" | "plot";

const AXIS_TAG: Record<Exclude<SplitAxis, "none">, string> = {
  team: "team",
  hdec_pic_name: "hdec-pic",
  plot: "plot",
};

const AXIS_LABEL: Record<Exclude<SplitAxis, "none">, string> = {
  team: "Team",
  hdec_pic_name: "HDEC PIC",
  plot: "Plot",
};

const ZIP_THRESHOLD = 7;

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
  expected_progress_today: "0.0%",
  today_actual: "0.0%",
  today_gap: "+0.0%;-0.0%;0.0%",
  plan_days: "0;-0;-",
  actual_duration: "0;-0;-",
  slip_days: "+0;-0;-",
};

// 자동판정 값별 정적 fill (ARGB)
const JUDGMENT_FILL: Record<string, string> = {
  Delayed: "FFFFC7CE",       // 지연 — 빨강
  "At Risk": "FFFFE699",     // 악화 — 노랑
  "On Track": "FFC6EFCE",    // 정상 — 초록
  Completed: "FFD9E1F2",     // 완료 — 파랑
};

export function ExportDialog({ open, onOpenChange, rows, visibleKeys }: Props) {
  const [format, setFormat] = useState<ExportFormat>("view");
  const [axis, setAxis] = useState<SplitAxis>("none");
  const [busy, setBusy] = useState(false);
  const resolveLabel = useTmColumnLabel();

  const run = async () => {
    setBusy(true);
    const toastId = toast.loading("내보내는 중...");
    try {
      const isView = format === "view";
      const keys = isView ? visibleKeys : TM_COLUMNS.map((c) => c.key);

      // T.Actual (오늘 실적) — data_date 별로 그룹화해 서버 RPC 배치 조회.
      const idsByDate = new Map<string, string[]>();
      for (const r of rows) {
        const id = String((r as any).id ?? "");
        const d = ((r as any).data_date as string | null) ?? "";
        if (!id || !d) continue;
        const dd = String(d).slice(0, 10);
        if (!idsByDate.has(dd)) idsByDate.set(dd, []);
        idsByDate.get(dd)!.push(id);
      }
      const tActualMap = new Map<string, number>();
      for (const [dd, ids] of idsByDate) {
        const { data, error } = await (supabase as any).rpc("tm_today_actual", {
          _ids: ids,
          _as_of: dd,
        });
        if (error) throw error;
        if (data != null && !Array.isArray(data)) {
          throw new Error("tm_today_actual RPC contract mismatch: expected jsonb array");
        }
        for (const row of ((data ?? []) as unknown[]) as Array<{ id: string; t_actual: number }>) {
          tActualMap.set(String(row.id), Number(row.t_actual) || 0);
        }
      }

      // Cum. Diff / T.Plan / T.Actual / T.Diff 모두 파생 계산으로 덮어쓴다 (임포트값 무시).
      const derivedRows = rows.map((r) => {
        const asOf = ((r as any).data_date as string | null) ?? undefined;
        const cumDiff = computeVariance(r as any, asOf);
        const tPlan = computeDailyPlan(r as any);
        const tActual = tActualMap.get(String((r as any).id)) ?? 0;
        const tDiff = computeDailyDiff(r as any, tActual);
        return {
          ...r,
          progress_variance: cumDiff,
          expected_progress_today: tPlan,
          today_actual: tActual,
          today_gap: tDiff,
        };
      });

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
      const ts = timestamp();
      const commonWriterOpts = {
        sheetName: "Task Management",
        columns,
        columnWidths,
        dateFields,
        numFmtByKey: NUMFMT_BY_KEY,
        cellFillFor: (key: string, value: unknown) => {
          if (key === "auto_judgment" && typeof value === "string") {
            return JUDGMENT_FILL[value] ?? null;
          }
          if (key === "risk" && value === "High") return "FFED7D31";
          return null;
        },
        rowFillFor: (row: Record<string, unknown>) => {
          const j = row["auto_judgment"];
          if (j === "Delayed") return "FFFDECEA";
          return null;
        },
      } as const;

      const buildHeader = (extraMeta?: string) => ({
        title: `Task Management Raw Data  (${isView ? "View" : "Re-import"})`,
        metaRows: [
          `Exported: ${exportedTs}`,
          `Rows: ${rows.length.toLocaleString()}   Columns: ${columns.length}`,
          "",
          "",
          extraMeta ?? "",
        ] as [string, string, string, string, string],
        freezeCols: isView ? 3 : 1,
      });

      const pagerFor = (rs: Record<string, unknown>[]) =>
        async (offset: number) => {
          if (offset >= rs.length) return { rows: [], total: rs.length };
          return { rows: rs.slice(offset, offset + 1000), total: rs.length };
        };

      if (axis === "none") {
        await streamXlsxExport({
          ...commonWriterOpts,
          filename: `CMS_TM_${format}_${ts}.xlsx`,
          header: buildHeader(),
          fetchPage: pagerFor(derivedRows),
        });
        toast.success(`${rows.length.toLocaleString()}건 내보내기 완료`, { id: toastId });
        onOpenChange(false);
        return;
      }

      // ── Per-axis split ──
      const axisKey = axis;
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const r of derivedRows) {
        const raw = (r as any)[axisKey];
        const key = raw != null && String(raw).trim() ? String(raw).trim() : "Unassigned";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      // Sort keys alphabetically; Unassigned last.
      const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        return a.localeCompare(b);
      });
      const axisTag = AXIS_TAG[axisKey];
      const axisLabel = AXIS_LABEL[axisKey];

      if (sortedKeys.length >= ZIP_THRESHOLD) {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        let done = 0;
        for (const key of sortedKeys) {
          const rs = groups.get(key)!;
          const { buffer } = await streamXlsxExport({
            ...commonWriterOpts,
            filename: `CMS_TM_${axisTag}-${sanitize(key)}.xlsx`,
            header: buildHeader(`Split: ${axisLabel} = ${key}`),
            fetchPage: pagerFor(rs),
            output: "buffer",
          });
          if (buffer) zip.file(`CMS_TM_${format}_${axisTag}-${sanitize(key)}_${ts}.xlsx`, buffer);
          groups.set(key, []);
          done += 1;
          toast.loading(`ZIP 생성 중 ${done} / ${sortedKeys.length}`, { id: toastId });
          await new Promise((r) => setTimeout(r, 0));
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `task-management_${format}_by-${axisTag}_${ts}.zip`);
        toast.success(`${sortedKeys.length}개 그룹 → ZIP 다운로드`, { id: toastId });
      } else {
        for (const key of sortedKeys) {
          const rs = groups.get(key)!;
          await streamXlsxExport({
            ...commonWriterOpts,
            filename: `CMS_TM_${format}_${axisTag}-${sanitize(key)}_${ts}.xlsx`,
            header: buildHeader(`Split: ${axisLabel} = ${key}`),
            fetchPage: pagerFor(rs),
          });
          groups.set(key, []);
          await new Promise((r) => setTimeout(r, 0));
        }
        toast.success(`${sortedKeys.length}개 파일 다운로드`, { id: toastId });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`, { id: toastId });
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
          <div>
            <Label className="text-xs">Output</Label>
            <RadioGroup
              value={axis}
              onValueChange={(v) => setAxis(v as SplitAxis)}
              className="mt-2 flex flex-col gap-2"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="none" className="mt-1" />
                <span>단일 파일</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="team" className="mt-1" />
                <span>Team 별 분리</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="hdec_pic_name" className="mt-1" />
                <span>HDEC PIC 별 분리</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="plot" className="mt-1" />
                <span>Plot 별 분리</span>
              </label>
            </RadioGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              그룹 수 ≥ {ZIP_THRESHOLD} 이면 자동으로 ZIP 으로 묶입니다.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Gantt 캘린더/파생 수식은 폐기되어 값은 정적으로 기록됩니다. 지연/악화 행은 셀 배경색으로 표시됩니다.
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

function sanitize(name: string): string {
  return (name || "Unassigned").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 40) || "Unassigned";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}