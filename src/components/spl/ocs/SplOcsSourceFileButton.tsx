import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSplOcsSourceFileUrl } from "@/lib/spl/ocs.functions";

/** 코멘트 원본 Excel 다운로드 — 파일이 없으면 명확히 안내 */
export function SplOcsSourceFileButton({
  commentId,
  fileName,
}: {
  commentId: string;
  fileName: string | null;
}) {
  const fetchUrl = useServerFn(getSplOcsSourceFileUrl);
  const [busy, setBusy] = useState(false);

  if (!fileName) return <span className="text-[10px] text-muted-foreground">Source Excel: not available</span>;

  const onClick = async () => {
    setBusy(true);
    try {
      const res = await fetchUrl({ data: { commentId } });
      if (!res?.available || !res.url) {
        toast.error("원본 Excel 파일을 찾을 수 없습니다.");
        return;
      }
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.file_name ?? fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(`원본 Excel 열기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto min-w-0 justify-start gap-1 p-0 text-[10px] font-normal"
      onClick={() => void onClick()}
      disabled={busy}
      title={`원본 파일 다운로드: ${fileName}`}
    >
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <FileSpreadsheet className="h-3 w-3 shrink-0" />}
      <span className="truncate">Source Excel: {fileName}</span>
    </Button>
  );
}
