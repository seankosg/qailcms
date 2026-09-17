import { useState } from "react";
import { dohaStampCompact } from "@/lib/time/doha";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { streamXlsxExport } from "@/lib/excel/stream-export";

/**
 * TOC Raw Data 내보내기.
 * SM(`ExportDialog.tsx`)의 대화창 구조·머리글 블록(제목 + 5줄 메타)을 그대로 따르되,
 * TOC 는 현재 화면 데이터(정본 조회 결과)를 원본으로 쓴다.
 */
interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 현재 필터·정렬이 적용된 전체 행 (페이지 슬라이스 이전) */
  getFilteredRows: () => Record<string, any>[];
  /** 현재 페이지에 보이는 행 */
  getPageRows: () => Record<string, any>[];
  columnHeaders: { key: string; label: string }[];
  dateFields: string[];
  meta: { userName: string; asOf: string; sourceLabel: string; search: string; filterSummary: string; sortSummary: string };
}

export function TocExportDialog({
  open,
  onOpenChange,
  getFilteredRows,
  getPageRows,
  columnHeaders,
  dateFields,
  meta,
}: Props) {
  const [scope, setScope] = useState<"filtered" | "page">("filtered");
  const [busy, setBusy] = useState(false);

  const exportNow = async () => {
    setBusy(true);
    const toastId = toast.loading("내보내기 준비 중...");
    try {
      const rows = scope === "page" ? getPageRows() : getFilteredRows();
      await streamXlsxExport({
        filename: `TOC_RawData_${scope === "page" ? "PAGE" : "FILTERED"}_${dohaStampCompact()}.xlsx`,
        sheetName: "TOC Raw Data",
        columns: columnHeaders,
        dateFields,
        header: {
          title: "QAIL CMS — Handover (TOC) Raw Data",
          metaRows: [
            `Exported by: ${meta.userName} · As-of: ${meta.asOf}`,
            `Source: ${meta.sourceLabel}`,
            `Search: ${meta.search || "(none)"}`,
            `Filters: ${meta.filterSummary || "(none)"}`,
            `Sort: ${meta.sortSummary || "(none)"}`,
          ],
          freezeCols: 3,
        },
        fetchPage: async (offset, limit) => ({
          rows: rows.slice(offset, offset + limit),
          total: rows.length,
        }),
        onProgress: (fetched, total) =>
          toast.loading(`내보내기 ${fetched.toLocaleString()} / ${total.toLocaleString()}`, { id: toastId }),
      });
      toast.success(`${rows.length.toLocaleString()}건 XLSX 다운로드 완료`, { id: toastId });
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
          <DialogTitle>Export — Handover (TOC) Raw Data</DialogTitle>
          <DialogDescription>
            현재 화면의 컬럼 구성·필터·정렬이 그대로 반영됩니다. 값은 정본 조회 결과이며 화면 표시와 동일합니다.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as "filtered" | "page")} className="space-y-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="filtered" id="toc-exp-filtered" />
            <Label htmlFor="toc-exp-filtered" className="text-sm">필터 적용 전체 ({getFilteredRows().length.toLocaleString()}건)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="page" id="toc-exp-page" />
            <Label htmlFor="toc-exp-page" className="text-sm">현재 페이지 ({getPageRows().length.toLocaleString()}건)</Label>
          </div>
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button onClick={exportNow} disabled={busy}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> {busy ? "내보내는 중..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
