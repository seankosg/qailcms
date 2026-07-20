import { useState } from "react";
import { dohaStampCompact } from "@/lib/time/doha";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  streamXlsxExport,
  type StyledHeaderBlock,
} from "@/lib/excel/stream-export";
import {
  buildDefectHeaderBlock,
  DEFECT_DATE_FIELDS,
  DEFECT_DATETIME_FIELDS,
  REIMPORT_MARKER,
  type DefectExportMeta,
} from "@/lib/defect-management/export-meta";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  getRows: () => Record<string, any>[];
  fetchAllRows?: (onProgress?: (fetched: number, total: number) => void) => Promise<Record<string, any>[]>;
  /** Paged fetcher used for memory-efficient single-file streaming exports. */
  fetchPage?: (
    offset: number,
    limit: number,
  ) => Promise<{ rows: Record<string, any>[]; total: number }>;
  columnHeaders: { key: string; label: string }[];
  /** Metadata used to build the SHAW-style styled header block. */
  meta: DefectExportMeta;
  sourceLabel: string;
  search: string;
  filterSummary: string;
  sortSummary: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  getRows,
  fetchAllRows,
  fetchPage,
  columnHeaders,
  meta,
  sourceLabel,
  search,
  filterSummary,
  sortSummary,
}: Props) {
  const [format, setFormat] = useState<"view" | "reimport">("view");
  const [mode, setMode] = useState<"single" | "per-subcon">("single");
  const [busy, setBusy] = useState(false);

  const exportNow = async () => {
    setBusy(true);
    const toastId = toast.loading("현재 필터 전체 행 수집 중...");
    try {
      const timestamp = dohaStampCompact();
      const stamp = format === "reimport" ? "REIMPORT" : "VIEW";

      const buildHeader = (sourceSuffix?: string): StyledHeaderBlock => {
        const b = buildDefectHeaderBlock({
          format,
          meta,
          sourceLabel,
          search,
          filterSummary,
          sortSummary,
          sourceSuffix,
        });
        return { title: b.title, metaRows: b.metaRows, freezeCols: 3 };
      };

      // ── Fast path: single-file + paged fetcher → true streaming (low memory) ──
      if (mode === "single" && fetchPage) {
        const cols = columnHeaders.map((h) => ({
          key: h.key,
          label: format === "reimport" ? h.key : h.label,
        }));
        const { count } = await streamXlsxExport({
          filename: `defect-raw-${stamp}-${timestamp}.xlsx`,
          sheetName: "Snags",
          columns: cols,
          chunkSize: 1000,
          fetchPage,
          transformRow: (r) => transformRow(r, columnHeaders, format),
          header: buildHeader(),
          dateFields: DEFECT_DATE_FIELDS,
          datetimeFields: DEFECT_DATETIME_FIELDS,
          onProgress: (fetched, total) => {
            toast.loading(`내보내는 중 ${fetched.toLocaleString()} / ${total.toLocaleString()}`, { id: toastId });
          },
        });
        toast.success(`${count.toLocaleString()}건 내보내기 완료`, { id: toastId });
        onOpenChange(false);
        return;
      }

      let rows: Record<string, any>[];
      if (fetchAllRows) {
        rows = await fetchAllRows((fetched, total) => {
          toast.loading(`수집 중 ${fetched.toLocaleString()} / ${total.toLocaleString()}`, { id: toastId });
        });
      } else {
        rows = getRows();
      }
      if (rows.length === 0) {
        toast.error("내보낼 행이 없습니다.", { id: toastId });
        setBusy(false);
        return;
      }
      if (mode === "single") {
        // Fallback single-file path: reuse the streaming writer with an
        // in-memory pager so we get the same SHAW-style header block.
        const cols = columnHeaders.map((h) => ({
          key: h.key,
          label: format === "reimport" ? h.key : h.label,
        }));
        await streamXlsxExport({
          filename: `defect-raw-${stamp}-${timestamp}.xlsx`,
          sheetName: "Snags",
          columns: cols,
          chunkSize: 1000,
          fetchPage: singleShotPager(rows),
          transformRow: (r) => transformRow(r, columnHeaders, format),
          header: buildHeader(),
          dateFields: DEFECT_DATE_FIELDS,
          datetimeFields: DEFECT_DATETIME_FIELDS,
        });
        toast.success(`${rows.length.toLocaleString()}건 내보내기 완료`, { id: toastId });
      } else {
        // Group by subcontractor
        const groups = new Map<string, Record<string, any>[]>();
        for (const r of rows) {
          const key = (r.subcontractor_name && String(r.subcontractor_name).trim()) || "Unassigned";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        }
        // Release the flat array now that we've grouped
        rows = [] as any;
        const cols = columnHeaders.map((h) => ({
          key: h.key,
          label: format === "reimport" ? h.key : h.label,
        }));
        if (groups.size >= 7) {
          // Use jszip — write each subcon workbook via streamXlsxExport into a buffer.
          const JSZip = (await import("jszip")).default;
          const ExcelJS = (await import("exceljs")).default;
          const zip = new JSZip();
          for (const [key, rs] of groups.entries()) {
            const buf = await buildStyledWorkbookBuffer(ExcelJS, {
              sheetName: "Snags",
              columns: cols,
              rows: rs.map((r) => transformRow(r, columnHeaders, format)),
              header: buildHeader(`Subcontractor: ${key}`),
              dateFields: DEFECT_DATE_FIELDS,
              datetimeFields: DEFECT_DATETIME_FIELDS,
            });
            zip.file(`${sanitize(key)}-${stamp}.xlsx`, buf);
            // free the group's rows after writing this sheet
            groups.set(key, []);
            await new Promise((r) => setTimeout(r, 0));
          }
          const blob = await zip.generateAsync({ type: "blob" });
          downloadBlob(blob, `defect-raw-per-subcon-${timestamp}.zip`);
          toast.success(`${groups.size}개 서브콘 → ZIP 다운로드`, { id: toastId });
        } else {
          for (const [key, rs] of groups.entries()) {
            await streamXlsxExport({
              filename: `defect-raw-${sanitize(key)}-${stamp}-${timestamp}.xlsx`,
              sheetName: "Snags",
              columns: cols,
              chunkSize: 1000,
              fetchPage: singleShotPager(rs),
              transformRow: (r) => transformRow(r, columnHeaders, format),
              header: buildHeader(`Subcontractor: ${key}`),
              dateFields: DEFECT_DATE_FIELDS,
              datetimeFields: DEFECT_DATETIME_FIELDS,
            });
            groups.set(key, []);
            await new Promise((r) => setTimeout(r, 0));
          }
          toast.success(`${groups.size}개 파일 다운로드`, { id: toastId });
        }
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`, { id: toastId });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Snag List — Raw Data 내보내기</DialogTitle>
          <DialogDescription>필터가 적용된 현재 행만 내보냅니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Format</div>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="view" id="fmt-view" className="mt-0.5" />
                <div className="flex-1"><Label htmlFor="fmt-view" className="text-sm font-medium">View-friendly</Label><p className="mt-1 text-xs text-muted-foreground">가독성 우선 (포맷된 날짜/%, 팀 라벨). 공유·리포트용.</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="reimport" id="fmt-re" className="mt-0.5" />
                <div className="flex-1"><Label htmlFor="fmt-re" className="text-sm font-medium">Re-import ready</Label><p className="mt-1 text-xs text-muted-foreground">ID 컬럼 포함, 원시값(YYYY-MM-DD, 숫자 %). 편집 후 다시 임포트하면 기존 행을 업데이트.</p></div>
              </div>
            </RadioGroup>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Output</div>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="single" id="out-s" className="mt-0.5" />
                <div className="flex-1"><Label htmlFor="out-s" className="text-sm font-medium">Single file</Label><p className="mt-1 text-xs text-muted-foreground">한 개의 .xlsx.</p></div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="per-subcon" id="out-p" className="mt-0.5" />
                <div className="flex-1"><Label htmlFor="out-p" className="text-sm font-medium">Subcontractor별 분리</Label><p className="mt-1 text-xs text-muted-foreground">서브콘 ≥ 7개면 ZIP 으로 묶습니다.</p></div>
              </div>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button size="sm" onClick={exportNow} disabled={busy}><Download className="mr-1.5 h-3.5 w-3.5" /> {busy ? "내보내는 중..." : "Export"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** In-memory paged fetcher used by fallback paths. */
function singleShotPager(rows: Record<string, any>[]) {
  let served = false;
  return async (_offset: number, _limit: number) => {
    if (served) return { rows: [] as Record<string, any>[], total: rows.length };
    served = true;
    return { rows, total: rows.length };
  };
}

/** Build a fully-styled workbook buffer for ZIP packaging. Mirrors
 *  streamXlsxExport's writer but returns bytes instead of triggering a download. */
async function buildStyledWorkbookBuffer(
  ExcelJS: typeof import("exceljs"),
  args: {
    sheetName: string;
    columns: { key: string; label: string }[];
    rows: Record<string, any>[];
    header: StyledHeaderBlock;
    dateFields: string[];
    datetimeFields: string[];
  },
): Promise<Uint8Array> {
  // Round-trip through streamXlsxExport-style logic. We inline it here rather
  // than exporting a second variant to keep the writer's memory profile.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(args.sheetName);
  const colCount = Math.max(args.columns.length, 2);
  const freezeCols = Math.min(args.header.freezeCols ?? 3, args.columns.length);
  const FONT = "Calibri";

  // Title
  const titleCell = ws.getCell(1, 1);
  titleCell.value = args.header.title;
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, colCount);
  ws.getRow(1).height = 24;

  for (let i = 0; i < 5; i++) {
    const r = 2 + i;
    const cell = ws.getCell(r, 1);
    cell.value = args.header.metaRows[i] ?? "";
    cell.font = {
      name: FONT,
      size: 10,
      bold: i === 0,
      color: { argb: i === 0 ? "FF374151" : "FF111827" },
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    ws.mergeCells(r, 1, r, colCount);
    ws.getRow(r).height = 16;
  }
  ws.getRow(7).height = 6;

  for (let c = 0; c < args.columns.length; c++) {
    const cell = ws.getCell(8, c + 1);
    cell.value = args.columns[c].label;
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F2937" } },
      bottom: { style: "thin", color: { argb: "FF1F2937" } },
      left: { style: "thin", color: { argb: "FF1F2937" } },
      right: { style: "thin", color: { argb: "FF1F2937" } },
    };
    ws.getColumn(c + 1).width = 18;
  }
  ws.getRow(8).height = 28;
  ws.views = [
    {
      state: "frozen",
      xSplit: freezeCols,
      ySplit: 8,
      topLeftCell: ws.getCell(9, freezeCols + 1).address,
      activeCell: ws.getCell(9, freezeCols + 1).address,
    },
  ];

  const dateSet = new Set(args.dateFields);
  const dtSet = new Set(args.datetimeFields);
  const dataBorder = {
    top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  };
  for (let i = 0; i < args.rows.length; i++) {
    const src = args.rows[i];
    const row = ws.getRow(9 + i);
    for (let c = 0; c < args.columns.length; c++) {
      const key = args.columns[c].key;
      const raw = src[key];
      const cell = row.getCell(c + 1);
      if (dateSet.has(key) && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        cell.value = new Date(raw.slice(0, 10) + "T00:00:00Z");
        cell.numFmt = "yyyy-mm-dd";
      } else if (dtSet.has(key) && typeof raw === "string" && raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          cell.value = d;
          cell.numFmt = "yyyy-mm-dd hh:mm";
        } else cell.value = String(raw);
      } else if (raw == null) cell.value = "";
      else if (typeof raw === "object") cell.value = JSON.stringify(raw);
      else cell.value = raw as any;
      cell.font = { name: FONT, size: 10, color: { argb: "FF111827" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = dataBorder;
    }
    row.height = 20;
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function transformRow(
  r: Record<string, any>,
  headers: { key: string; label: string }[],
  format: "view" | "reimport",
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const h of headers) {
    const v = r[h.key];
    if (v == null) { out[h.key] = ""; continue; }
    if (format === "reimport") { out[h.key] = v; continue; }
    if (typeof v === "number" && h.key.endsWith("_pct")) {
      out[h.key] = v > 1 ? `${v.toFixed(1)}%` : `${(v * 100).toFixed(1)}%`;
    } else {
      out[h.key] = v;
    }
  }
  return out;
}

// keep `REIMPORT_MARKER` reachable for downstream code paths that read it.
void REIMPORT_MARKER;

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}