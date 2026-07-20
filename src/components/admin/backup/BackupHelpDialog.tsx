import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HelpCircle, Download, FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  BACKUP_GUIDE_MARKDOWN,
  downloadGuideMarkdown,
  downloadGuidePdf,
} from "@/lib/backup/download-guide";

type Props = {
  triggerLabel?: string;
  variant?: "outline" | "secondary" | "ghost" | "default";
};

export function BackupHelpDialog({ triggerLabel = "도움말 / Help", variant = "outline" }: Props) {
  const [open, setOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  async function handlePdf() {
    setPdfLoading(true);
    try {
      await downloadGuidePdf(contentRef.current);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" className="gap-1.5">
          <HelpCircle className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="text-base font-semibold">
            백업 &amp; 복원 사용자 가이드
          </DialogTitle>
          <div className="flex gap-2 pr-6">
            <Button variant="outline" size="sm" onClick={downloadGuideMarkdown} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={handlePdf} disabled={pdfLoading} className="gap-1.5">
              {pdfLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              PDF
            </Button>
          </div>
        </DialogHeader>
        <div className="overflow-y-auto px-6 py-5">
          <article
            ref={contentRef}
            className="prose prose-sm dark:prose-invert max-w-none
              prose-headings:scroll-mt-4
              prose-h1:text-2xl prose-h1:font-bold prose-h1:mt-0
              prose-h2:text-lg prose-h2:mt-8 prose-h2:border-b prose-h2:pb-1
              prose-h3:text-base prose-h3:mt-5
              prose-table:text-xs prose-th:bg-muted prose-th:px-2 prose-th:py-1
              prose-td:px-2 prose-td:py-1
              prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs
              prose-blockquote:border-l-4 prose-blockquote:border-amber-400 prose-blockquote:bg-amber-50 dark:prose-blockquote:bg-amber-950/30 prose-blockquote:py-1 prose-blockquote:pl-3 prose-blockquote:not-italic
              prose-a:text-primary"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {BACKUP_GUIDE_MARKDOWN.replace(/^---[\s\S]*?---\n/, "")}
            </ReactMarkdown>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}