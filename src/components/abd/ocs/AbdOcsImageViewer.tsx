import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OCS_ATTACHMENT_BUCKET, type AbdOcsAttachment } from "@/lib/abd/ocs.functions";

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const { data, error } = await supabase.storage
    .from(OCS_ATTACHMENT_BUCKET)
    .createSignedUrls(paths, 300);
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  (data ?? []).forEach((d) => {
    if (d.signedUrl && d.path) map[d.path] = d.signedUrl;
  });
  return map;
}

export function AbdOcsImageViewer({
  open,
  onOpenChange,
  attachments,
  ocsNumber,
  startIndex,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  attachments: AbdOcsAttachment[];
  ocsNumber: string | null;
  startIndex: number;
}) {
  const [index, setIndex] = useState(startIndex);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    if (open) {
      setIndex(startIndex);
      setZoom(1);
      setRetried(false);
    }
  }, [open, startIndex]);

  const load = useCallback(async () => {
    if (!open || attachments.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      setUrls(await signPaths(attachments.map((a) => a.storage_path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [open, attachments]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = attachments.length;
  const current = attachments[index];
  const url = current ? urls[current.storage_path] : undefined;

  const go = useCallback(
    (delta: number) => {
      setZoom(1);
      setIndex((i) => (count === 0 ? 0 : (i + delta + count) % count));
    },
    [count],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  const onImgError = () => {
    if (!retried) {
      setRetried(true);
      void load();
    } else {
      setError(
        "Unable to load this image. It may be unavailable or you may not have permission to view it.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1200px,95vw)] p-4">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-sm">
            OCS {ocsNumber ?? "—"} — Attachment {count === 0 ? 0 : index + 1}/{count}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Use the Left and Right Arrow keys to navigate. Use + and − to zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => go(-1)} disabled={count < 2} aria-label="Previous image" title="Previous image">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => go(1)} disabled={count < 2} aria-label="Next image" title="Next image">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="sm" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" aria-label="Reset zoom" title="Reset zoom" onClick={() => setZoom(1)}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Download"
              title="Download"
              disabled={!url}
              onClick={() => {
                if (!url) return;
                const a = document.createElement("a");
                a.href = url;
                a.download = current?.storage_path.split("/").pop() ?? "ocs-attachment";
                a.target = "_blank";
                a.rel = "noopener";
                a.click();
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2 flex max-h-[62vh] min-h-[240px] items-center justify-center overflow-auto rounded-md border bg-muted/30 p-2">
          {loading && !url ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading image…
            </span>
          ) : error ? (
            <span className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </span>
          ) : url ? (
            <img
              src={url}
              alt={`OCS ${ocsNumber ?? "—"} attachment ${index + 1}`}
              onError={onImgError}
              style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
              className="max-w-full"
            />
          ) : (
            <span className="text-xs text-muted-foreground">No image available.</span>
          )}
        </div>

        {count > 1 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {attachments.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setIndex(i);
                  setZoom(1);
                }}
                aria-label={`View OCS ${ocsNumber ?? "—"} attachment ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  "h-14 w-14 shrink-0 overflow-hidden rounded border bg-muted/40",
                  i === index && "ring-2 ring-primary",
                )}
              >
                {urls[a.storage_path] ? (
                  <img src={urls[a.storage_path]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}