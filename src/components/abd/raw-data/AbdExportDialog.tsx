import { useState } from "react";
import { dohaStampCompact, dohaDateTime } from "@/lib/time/doha";
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
import { ABD_COLUMNS } from "@/lib/abd/columns";
import { streamXlsxExport } from "@/lib/excel/stream-export";
import { fetchAllAbdRowsForExport, type AbdExportFetchParams } from "@/lib/abd/export-fetch";

type ExportFormat = "view" | "reimport";
type SplitAxis = "none" | "team" | "hdec_eng_name" | "plot" | "dis";

const AXIS_TAG: Record<Exclude<SplitAxis, "none">, string> = {
  team: "team",
  hdec_eng_name: "hdec-eng",
  plot: "plot",
  dis: "dis",
};

const AXIS_LABEL: Record<Exclude<SplitAxis, "none">, string> = {
  team: "Team",
  hdec_eng_name: "HDEC ENG",
  plot: "Plot",
  dis: "DIS",
};

const ZIP_THRESHOLD = 7;

// 상태/스테이지 값별 정적 셀 배경 (ARGB)
const STATUS_FILL: Record<string, string> = {
  A: "FFC6EFCE", // 승인 — 초록
  B: "FFFFE699", // 조건부 — 노랑
  C: "FFFFC7CE", // 반려 — 빨강
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 현재 필터 결과 전체 행수 (서버 total) */
  total: number;
  /** 서버 재조회용 현재 쿼리 파라미터 */
  fetchParams: AbdExportFetchParams;
  /** View 포맷용 — 화면 표시 컬럼 순서/라벨 */
  exportColumns: { key: string; label: string }[];
}

function timestamp() {
  const s = dohaStampCompact(); // YYYYMMDDHHmm
  return `${s.slice(0, 8)}_${s.slice(8)}`;
}

export function AbdExportDialog({ open, onOpenChange, total, fetchParams, exportColumns }: Props) {
  const [format, setFormat] = useState<ExportFormat>("view");
  const [axis, setAxis] = useState<SplitAxis>("none");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const toastId = toast.loading("데이터를 불러오는 중...");
    try {
      const allRows = await fetchAllAbdRowsForExport(fetchParams, (loaded, tot) => {
        toast.loading(`데이터 불러오는 중 ${loaded.toLocaleString()} / ${tot.toLocaleString()}`, {
          id: toastId,
        });
      });
      if (allRows.length === 0) {
        toast.error("내보낼 행이 없습니다.", { id: toastId });
        setBusy(false);
        return;
      }

      const isView = format === "view";
      const columns = isView
        ? exportColumns.map((c) => ({ key: c.key, label: c.label }))
        : ABD_COLUMNS.map((c) => ({ key: c.key, label: c.key }));

      const defByKey = new Map(ABD_COLUMNS.map((c) => [c.key, c] as const));
      const columnWidths: Record<string, number> = {};
      for (const c of columns) {
        const w = defByKey.get(c.key)?.width;
        columnWidths[c.key] = w ? Math.max(8, Math.min(60, Math.round(w / 7))) : 18;
      }
      const dateFields = ABD_COLUMNS.filter((c) => c.type === "date").map((c) => c.key);
      const numFmtByKey: Record<string, string> = {};
      for (const c of ABD_COLUMNS) {
        if (c.type === "date") numFmtByKey[c.key] = "yyyy-mm-dd";
        else if (c.type === "number") numFmtByKey[c.key] = "0;-0;-";
      }

      const exportedTs = dohaDateTime();
      const ts = timestamp();

      const commonWriterOpts = {
        sheetName: "ABD",
        columns,
        columnWidths,
        dateFields,
        numFmtByKey,
        cellFillFor: (key: string, value: unknown) => {
          if (
            (key === "latest_status" ||
              key === "r1_response_result" ||
              key === "r2_response_result" ||
              key === "r3_response_result") &&
            typeof value === "string"
          ) {
            return STATUS_FILL[value.trim().toUpperCase()] ?? null;
          }
          return null;
        },
        rowFillFor: (row: Record<string, unknown>) => {
          const d = row["is_delayed"];
          return d === true ? "FFFDECEA" : null;
        },
      } as const;

      const buildHeader = (rowCount: number, extraMeta?: string) => ({
        title: `ABD Raw Data  (${isView ? "View" : "Re-import"})`,
        metaRows: [
          `Exported: ${exportedTs}`,
          `Rows: ${rowCount.toLocaleString()}   Columns: ${columns.length}`,
          fetchParams.q ? `Search: ${fetchParams.q}` : "",
          `Team: ${fetchParams.team}${fetchParams.plot ? `   Plot: ${fetchParams.plot}` : ""}   As-of: ${
            fetchParams.asOf ?? ""
          }`,
          extraMeta ?? "",
        ] as [string, string, string, string, string],
        freezeCols: isView ? 3 : 1,
      });

      const pagerFor = (rs: Record<string, unknown>[]) => async (offset: number) => {
        if (offset >= rs.length) return { rows: [], total: rs.length };
        return { rows: rs.slice(offset, offset + 1000), total: rs.length };
      };

      if (axis === "none") {
        toast.loading("파일 생성 중...", { id: toastId });
        await streamXlsxExport({
          ...commonWriterOpts,
          filename: `CMS_ABD_${format}_${ts}.xlsx`,
          header: buildHeader(allRows.length),
          fetchPage: pagerFor(allRows),
        });
        toast.success(`${allRows.length.toLocaleString()}건 내보내기 완료`, { id: toastId });
        onOpenChange(false);
        return;
      }

      // ── Per-axis split ──
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const r of allRows) {
        const raw = (r as any)[axis];
        const key = raw != null && String(raw).trim() ? String(raw).trim() : "Unassigned";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        return a.localeCompare(b);
      });
      const axisTag = AXIS_TAG[axis];
      const axisLabel = AXIS_LABEL[axis];

      if (sortedKeys.length >= ZIP_THRESHOLD) {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        let done = 0;
        for (const key of sortedKeys) {
          const rs = groups.get(key)!;
          const { buffer } = await streamXlsxExport({
            ...commonWriterOpts,
            filename: `CMS_ABD_${axisTag}-${sanitize(key)}.xlsx`,
            header: buildHeader(rs.length, `Split: ${axisLabel} = ${key}`),
            fetchPage: pagerFor(rs),
            output: "buffer",
          });
          if (buffer) zip.file(`CMS_ABD_${format}_${axisTag}-${sanitize(key)}_${ts}.xlsx`, buffer);
          groups.set(key, []);
          done += 1;
          toast.loading(`ZIP 생성 중 ${done} / ${sortedKeys.length}`, { id: toastId });
          await new Promise((r) => setTimeout(r, 0));
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `abd_${format}_by-${axisTag}_${ts}.zip`);
        toast.success(`${sortedKeys.length}개 그룹 → ZIP 다운로드`, { id: toastId });
      } else {
        for (const key of sortedKeys) {
          const rs = groups.get(key)!;
          await streamXlsxExport({
            ...commonWriterOpts,
            filename: `CMS_ABD_${format}_${axisTag}-${sanitize(key)}_${ts}.xlsx`,
            header: buildHeader(rs.length, `Split: ${axisLabel} = ${key}`),
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
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export ABD Raw Data</DialogTitle>
          <DialogDescription>
            현재 필터 결과{" "}
            <span className="font-medium tabular-nums">{total.toLocaleString()}</span>행을 내보냅니다.
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
                <RadioGroupItem value="hdec_eng_name" className="mt-1" />
                <span>HDEC ENG 별 분리</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="plot" className="mt-1" />
                <span>Plot 별 분리</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="dis" className="mt-1" />
                <span>DIS 별 분리</span>
              </label>
            </RadioGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              그룹 수 ≥ {ZIP_THRESHOLD} 이면 자동으로 ZIP 으로 묶입니다.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            현재 페이지가 아닌 필터 결과 전체를 서버에서 다시 조회해 내보냅니다. 값은 정적으로 기록되며 상태/결과 셀은 배경색으로 표시됩니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={run} disabled={busy || total === 0}>
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