import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAbdOcsSourceFileUrl } from "@/lib/abd/ocs-source.functions";

export function AbdOcsSourceFileButton({
  commentId,
  fileName,
}: {
  commentId: string;
  fileName: string | null;
}) {
  const fetchUrl = useServerFn(getAbdOcsSourceFileUrl);
  const [busy, setBusy] = useState(false);

  if (!fileName) return <span className="text-[10px] text-muted-foreground">Source Excel: —</span>;

  const onClick = async () => {
    setBusy(true);
    try {
      const res = await fetchUrl({ data: { commentId } });
      if (!res?.available) {
        toast.error("Original Excel file is not available.");
        return;
      }
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.file_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Original Excel file is not available.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto max-w-full justify-start gap-1 p-0 text-[10px] font-normal"
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
  );
}