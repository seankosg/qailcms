import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  getRows: () => Record<string, any>[];
  columnHeaders: { key: string; label: string }[];
}

export function ExportDialog({ open, onOpenChange, getRows, columnHeaders }: Props) {
  const [format, setFormat] = useState<"view" | "reimport">("view");
  const [mode, setMode] = useState<"single" | "per-subcon">("single");
  const [busy, setBusy] = useState(false);

  const exportNow = async () => {
    setBusy(true);
    try {
      const rows = getRows();
      if (rows.length === 0) {
        toast.error("내보낼 행이 없습니다.");
        setBusy(false);
        return;
      }
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const stamp = format === "reimport" ? "REIMPORT" : "VIEW";
      if (mode === "single") {
        const wb = XLSX.utils.book_new();
        const ws = buildSheet(rows, columnHeaders, format);
        if (format === "reimport") ws["!marker" as any] = "QAIL_DEFECT_REIMPORT_V1";
        XLSX.utils.book_append_sheet(wb, ws, "Defects");
        XLSX.writeFile(wb, `defect-raw-${stamp}-${timestamp}.xlsx`);
        toast.success(`${rows.length}건 내보내기 완료`);
      } else {
        // Group by subcontractor
        const groups = new Map<string, Record<string, any>[]>();
        for (const r of rows) {
          const key = (r.subcontractor_name && String(r.subcontractor_name).trim()) || "Unassigned";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
        }
        if (groups.size >= 7) {
          // Use jszip
          const JSZip = (await import("jszip")).default;
          const zip = new JSZip();
          for (const [key, rs] of groups.entries()) {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, buildSheet(rs, columnHeaders, format), "Defects");
            const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
            zip.file(`${sanitize(key)}-${stamp}.xlsx`, buf);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          downloadBlob(blob, `defect-raw-per-subcon-${timestamp}.zip`);
          toast.success(`${groups.size}개 서브콘 → ZIP 다운로드`);
        } else {
          for (const [key, rs] of groups.entries()) {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, buildSheet(rs, columnHeaders, format), "Defects");
            XLSX.writeFile(wb, `defect-raw-${sanitize(key)}-${stamp}-${timestamp}.xlsx`);
          }
          toast.success(`${groups.size}개 파일 다운로드`);
        }
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Defect Raw Data 내보내기</DialogTitle>
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

function buildSheet(rows: Record<string, any>[], headers: { key: string; label: string }[], format: "view" | "reimport") {
  const aoa: any[][] = [];
  aoa.push(headers.map((h) => (format === "reimport" ? h.key : h.label)));
  for (const r of rows) {
    aoa.push(headers.map((h) => {
      const v = r[h.key];
      if (v == null) return "";
      if (format === "reimport") return v;
      // view-friendly: keep ISO for dates, pct for percents
      if (typeof v === "number" && (h.key.endsWith("_pct"))) return v > 1 ? `${v.toFixed(1)}%` : `${(v * 100).toFixed(1)}%`;
      return v;
    }));
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

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