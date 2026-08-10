import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSplDocumentUrl, listSplDocuments } from "@/lib/spl/documents.functions";

function fmtBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** SPL 항목에 연결된 제출 문서(PDF) 목록 패널 */
export function SplDocumentPanel({
  splItemId,
  open,
  onOpenChange,
}: {
  splItemId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fetchDocs = useServerFn(listSplDocuments);
  const fetchUrl = useServerFn(getSplDocumentUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["spl-documents", splItemId],
    queryFn: () => fetchDocs({ data: { splItemId } }),
    enabled: open,
  });

  const openPdf = async (documentId: string) => {
    const tab = window.open("", "_blank");
    const res = await fetchUrl({ data: { documentId } });
    if (res.available && res.url) {
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
    } else {
      tab?.close();
    }
  };

  const docs = data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-sm">Documents ({docs.length})</SheetTitle>
        </SheetHeader>
        <ScrollArea className="mt-3 h-[calc(100vh-6rem)] pr-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : docs.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">연결된 제출 문서가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {docs.map((d) => (
                <div key={d.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="break-all font-mono font-medium">{d.document_number}</span>
                        <Badge variant="outline" className="text-[10px]">Rev.{d.revision ?? "—"}</Badge>
                      </div>
                      {d.title && <div className="mt-1 text-muted-foreground">{d.title}</div>}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-[11px]" onClick={() => void openPdf(d.id)}>
                      <ExternalLink className="h-3 w-3" /> Open PDF
                    </Button>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <div><dt className="text-[10px] uppercase text-muted-foreground">File</dt><dd className="break-all">{d.file_name}</dd></div>
                    <div><dt className="text-[10px] uppercase text-muted-foreground">Size</dt><dd>{fmtBytes(d.byte_size)}</dd></div>
                    <div><dt className="text-[10px] uppercase text-muted-foreground">Pages</dt><dd>{d.page_count ?? "—"}</dd></div>
                    <div><dt className="text-[10px] uppercase text-muted-foreground">Mapping</dt><dd>{d.mapping_method ?? "—"}</dd></div>
                    <div className="col-span-2">
                      <dt className="text-[10px] uppercase text-muted-foreground">SHA-256</dt>
                      <dd className="break-all font-mono text-[10px]">{d.content_hash ?? "—"}</dd>
                    </div>
                  </dl>

                  {d.number_mismatch && (
                    <div className="mt-2 flex items-start gap-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <div>
                        <div className="font-medium">문서번호 불일치</div>
                        <div className="break-all">파일명 {d.filename_document_number} · 표지 {d.internal_document_number}</div>
                        {d.link_note && <div className="mt-0.5">{d.link_note}</div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
