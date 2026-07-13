import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  getRows: () => Record<string, any>[];
  columnHeaders: { key: string; label: string }[];
  filenamePrefix?: string;
}

export function AbdExportDialog({ open, onOpenChange, getRows, columnHeaders, filenamePrefix = "abd-raw" }: Props) {
  const [busy, setBusy] = useState(false);
  const exportNow = async () => {
    setBusy(true);
    try {
      const rows = getRows();
      if (rows.length === 0) { toast.error("내보낼 행이 없습니다."); setBusy(false); return; }
      const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const aoa: any[][] = [columnHeaders.map((h) => h.label)];
      for (const r of rows) aoa.push(columnHeaders.map((h) => r[h.key] ?? ""));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ABD");
      XLSX.writeFile(wb, `${filenamePrefix}-${timestamp}.xlsx`);
      toast.success(`${rows.length}건 내보내기 완료`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ABD Raw Data 내보내기</DialogTitle>
          <DialogDescription>현재 페이지에 로드된 행만 내보냅니다.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button size="sm" onClick={exportNow} disabled={busy}><Download className="mr-1.5 h-3.5 w-3.5" /> {busy ? "내보내는 중..." : "Export"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}