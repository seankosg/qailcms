import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAbdOcsSourceFileUrl } from "@/lib/abd/ocs-source.functions";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

export function AbdOcsSourceFileButton({
  commentId,
  fileName,
}: {
  commentId: string;
  fileName: string | null;
}) {
  const fetchUrl = useServerFn(getAbdOcsSourceFileUrl);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  if (!fileName) return <span className="text-[10px] text-muted-foreground">Source Excel: —</span>;

  const onClick = async () => {
    setBusy(true);
    try {
      const res = await fetchUrl({ data: { commentId } });
      if (!res?.available) {
        toast.error("Original Excel file is not available.");
        return;
      }
      // 서명 URL은 교차 출처라 a[download] 가 무시될 수 있어 blob 으로 받아 저장한다.
      const resp = await fetch(res.url);
      if (!resp.ok) throw new Error("fetch failed");
      const raw = await resp.blob();
      const mime = res.file_name.toLowerCase().endsWith(".xls") ? XLS_MIME : XLSX_MIME;
      const blob = raw.type && raw.type !== "application/octet-stream" ? raw : new Blob([raw], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = res.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      toast.success(`${res.file_name} 다운로드 완료 — 파일을 열면 Excel에서 실행됩니다.`);
    } catch {
      toast.error("Original Excel file is not available.");
    } finally {
      setBusy(false);
    }
  };

  // Windows/macOS 데스크톱 Excel 로 직접 열기 (Office URI scheme)
  const onOpenInExcel = async () => {
    setOpening(true);
    try {
      const res = await fetchUrl({ data: { commentId } });
      if (!res?.available) {
        toast.error("Original Excel file is not available.");
        return;
      }
      window.location.href = `ms-excel:ofv|u|${res.url}`;
      toast.info("데스크톱 Excel 실행을 요청했습니다. 열리지 않으면 다운로드 후 열어 주세요.");
    } catch {
      toast.error("Original Excel file is not available.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex max-w-full items-center gap-2">
      <Button
        variant="link"
        size="sm"
        className="h-auto min-w-0 justify-start gap-1 p-0 text-[10px] font-normal"
        onClick={() => void onClick()}
        disabled={busy}
        title={`Download Original Excel: ${fileName}`}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">Source Excel: {fileName}</span>
      </Button>
      <Button
        variant="link"
        size="sm"
        className="h-auto shrink-0 gap-1 p-0 text-[10px] font-normal"
        onClick={() => void onOpenInExcel()}
        disabled={opening}
        title="설치된 Excel 프로그램으로 바로 열기"
      >
        {opening ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ExternalLink className="h-3 w-3 shrink-0" />
        )}
        Excel에서 열기
      </Button>
    </div>
  );
}