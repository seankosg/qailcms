import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";

export interface DuplicateOccurrence {
  sheet_name: string;
  excel_row: number;
  sl_no: number | null;
  document_title: string | null;
}

export interface DuplicateGroup {
  abd_number: string;
  occurrences: DuplicateOccurrence[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  duplicates: DuplicateGroup[];
  allowed?: boolean;
  onAllow?: () => void;
  onRevoke?: () => void;
}

function toTsv(dups: DuplicateGroup[]): string {
  const header = ["ABD_NUMBER", "Sheet", "Excel Row", "Sl.No", "Document Title"].join("\t");
  const lines = [header];
  for (const g of dups) {
    for (const o of g.occurrences) {
      lines.push([g.abd_number, o.sheet_name, o.excel_row, o.sl_no ?? "", (o.document_title ?? "").replace(/\t|\n/g, " ")].join("\t"));
    }
  }
  return lines.join("\n");
}

function toCsv(dups: DuplicateGroup[]): string {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["ABD_NUMBER", "Sheet", "Excel Row", "Sl.No", "Document Title"].map(esc).join(",");
  const lines = [header];
  for (const g of dups) {
    for (const o of g.occurrences) {
      lines.push([g.abd_number, o.sheet_name, o.excel_row, o.sl_no ?? "", o.document_title ?? ""].map(esc).join(","));
    }
  }
  return lines.join("\n");
}

export function AbdDuplicateReviewDialog({ open, onOpenChange, fileName, duplicates, allowed, onAllow, onRevoke }: Props) {
  const totalRows = useMemo(() => duplicates.reduce((s, g) => s + g.occurrences.length, 0), [duplicates]);

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(duplicates));
      toast.success("중복 목록이 클립보드에 복사되었습니다 (엑셀에 붙여넣기 가능).");
    } catch (err: any) {
      toast.error(`복사 실패: ${err?.message ?? err}`);
    }
  };

  const downloadCsv = () => {
    const blob = new Blob(["\ufeff" + toCsv(duplicates)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, "")}_duplicates.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">중복된 ABD_NUMBER — {duplicates.length}건 ({totalRows}행)</DialogTitle>
          <DialogDescription className="text-xs">
            {fileName} 파일 내에 동일한 <code>ABD_NUMBER</code> 가 2회 이상 등장합니다.
            아래 상세 목록을 확인한 뒤, <b>원본 엑셀을 수정하고 재업로드</b>하거나
            <b>중복을 허용하고 그대로 임포트</b>할 수 있습니다.
            중복 허용 시 첫 행은 원본 <code>ABD_NUMBER</code> 로 저장되고,
            2번째 이후 행은 뒤에 <code>-02</code>, <code>-03</code> … 접미사가 붙어 <b>모두 별도 행으로 저장</b>됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th className="text-left px-2 py-1.5">ABD_NUMBER</th>
                <th className="text-left px-2 py-1.5 w-32">Sheet</th>
                <th className="text-right px-2 py-1.5 w-20">Excel Row</th>
                <th className="text-right px-2 py-1.5 w-16">Sl.No</th>
                <th className="text-left px-2 py-1.5">Document Title</th>
              </tr>
            </thead>
            <tbody>
              {duplicates.map((g) =>
                g.occurrences.map((o, i) => (
                  <tr key={`${g.abd_number}-${o.sheet_name}-${o.excel_row}`} className={i === 0 ? "border-t-2 border-destructive/40" : "border-t"}>
                    <td className={"px-2 py-1 font-mono " + (i === 0 ? "font-semibold" : "text-muted-foreground")}>{i === 0 ? g.abd_number : ""}</td>
                    <td className="px-2 py-1">{o.sheet_name}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{o.excel_row}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{o.sl_no ?? "—"}</td>
                    <td className="px-2 py-1">{o.document_title ?? "—"}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copyTsv}>
              <Copy className="mr-1 h-3.5 w-3.5" /> 클립보드 복사 (TSV)
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCsv}>
              <Download className="mr-1 h-3.5 w-3.5" /> CSV 다운로드
            </Button>
          </div>
          <div className="flex gap-2">
            {allowed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onRevoke?.();
                  onOpenChange(false);
                }}
              >
                중복 허용 취소
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onAllow?.();
                  onOpenChange(false);
                }}
                disabled={!onAllow}
              >
                중복 허용하고 진행 (2번째부터 -02, -03… 부여)
              </Button>
            )}
            <Button size="sm" onClick={() => onOpenChange(false)}>닫기</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}