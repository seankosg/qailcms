import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SparePartImportProvider,
  useSparePartImport,
  type FileStatus,
  type ImportFileItem,
} from "@/contexts/SparePartImportContext";
import { useModuleGuard } from "@/hooks/useModuleGuard";
import { ModuleGuardDialog } from "@/components/import/ModuleGuardDialog";

const statusBadge: Record<FileStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing", cls: "bg-muted text-muted-foreground" },
  ready: { label: "Ready", cls: "bg-primary/10 text-primary" },
  processing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
  done: {
    label: "Done",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SparePartImportPage() {
  return (
    <SparePartImportProvider>
      <ImportPage />
    </SparePartImportProvider>
  );
}

function ImportPage() {
  const {
    files,
    isRunning,
    isCancelling,
    requestCancel,
    addFiles,
    removeFile,
    clearAll,
    setFileExcludedHeaders,
    startImport,
  } = useSparePartImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [colDialogFileId, setColDialogFileId] = useState<string | null>(null);
  const guard = useModuleGuard("spare_part", (fs) => addFiles(fs));

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void guard.receive(Array.from(e.dataTransfer.files));
    },
    [guard],
  );
  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void guard.receive(e.target.files ? Array.from(e.target.files) : []);
      if (inputRef.current) inputRef.current.value = "";
    },
    [guard],
  );

  const readyCount = files.filter((f) => f.status === "ready").length;
  const invalidCount = files.filter(
    (f) => f.status === "ready" && f.validationError,
  ).length;
  const importableCount = readyCount - invalidCount;
  const activeDialogFile = files.find((f) => f.id === colDialogFileId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Spare Part — Import</h1>
        <p className="text-sm text-muted-foreground">
          Excel 파일을 업로드하여 Spare Parts Raw Data에 upsert합니다. `Doc Ref`
          컬럼이 키이며, 동일 키는 자동 갱신됩니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload Files</CardTitle>
          <CardDescription>
            .xlsx / .xls / .xlsm 을 드래그 앤 드롭하거나 클릭하여 선택합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition hover:border-primary hover:bg-accent/30"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Excel 파일을 드롭하거나 클릭하여 선택
            </p>
            <p className="text-xs text-muted-foreground">
              .xlsx / .xls / .xlsm — 다중 시트 지원
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.xlsm"
              className="hidden"
              onChange={onSelect}
            />
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                2. Files ({files.length})
              </CardTitle>
              <CardDescription>
                {importableCount} ready to import
                {invalidCount > 0 && (
                  <span className="ml-2 text-destructive">
                    · {invalidCount} blocked
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                disabled={isRunning}
              >
                Clear all
              </Button>
              {isRunning && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={requestCancel}
                  disabled={isCancelling}
                >
                  {isCancelling ? "취소 중…" : "취소"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={startImport}
                disabled={isRunning || importableCount === 0}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Importing…
                  </>
                ) : (
                  `Start import (${importableCount})`
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                isRunning={isRunning}
                onRemove={() => removeFile(f.id)}
                onOpenColumns={() => setColDialogFileId(f.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <ColumnSelectDialog
        file={activeDialogFile}
        onClose={() => setColDialogFileId(null)}
        onApply={(excluded) => {
          if (!activeDialogFile) return;
          void setFileExcludedHeaders(activeDialogFile.id, excluded);
          setColDialogFileId(null);
        }}
      />
      <ModuleGuardDialog {...guard.dialogProps} />
    </div>
  );
}

function FileRow({
  file: f,
  isRunning,
  onRemove,
  onOpenColumns,
}: {
  file: ImportFileItem;
  isRunning: boolean;
  onRemove: () => void;
  onOpenColumns: () => void;
}) {
  const badge = statusBadge[f.status];
  const emptyKey = f.emptyKeyCount ?? 0;
  const dupKey = f.duplicateKeyCount ?? 0;
  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(f.size)}
              {f.sheetNames && ` · ${f.sheetNames.length} sheet(s)`}
              {f.parsedCount > 0 && ` · ${f.parsedCount} rows`}
            </p>
            {f.availableHeaders && f.availableHeaders.length > 0 && (
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={onOpenColumns}
                  disabled={
                    isRunning || f.status === "done" || f.status === "parsing"
                  }
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Select Columns (
                  {f.availableHeaders.length -
                    (f.excludedHeaders?.length ?? 0)}
                  /{f.availableHeaders.length})
                </Button>
              </div>
            )}
            {f.validationError && f.status !== "failed" && (
              <div className="mt-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{f.validationError}</span>
              </div>
            )}
            {f.error && (
              <div className="mt-1 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                ⚠ {f.error}
              </div>
            )}
            {f.unknownHeaders && f.unknownHeaders.length > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Unmapped: {f.unknownHeaders.slice(0, 5).join(", ")}
                {f.unknownHeaders.length > 5
                  ? ` (+${f.unknownHeaders.length - 5})`
                  : ""}
              </p>
            )}
            {(emptyKey > 0 || dupKey > 0) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {emptyKey > 0 ? `Empty Doc Ref: ${emptyKey}` : ""}
                {emptyKey > 0 && dupKey > 0 ? " · " : ""}
                {dupKey > 0 ? `In-file duplicates: ${dupKey}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={badge.cls}>{badge.label}</Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRemove}
            disabled={isRunning}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {f.status === "processing" && (
        <Progress value={f.progress} className="mt-2 h-1.5" />
      )}
      {f.result && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Inserted: {f.result.inserted}
          </Badge>
          <Badge variant="outline" className="border-blue-300 text-blue-700">
            Updated: {f.result.updated}
          </Badge>
          {f.result.skipped > 0 && (
            <Badge variant="outline" className="border-amber-400 text-amber-700">
              Skipped: {f.result.skipped}
            </Badge>
          )}
          {f.result.rejected > 0 && (
            <Badge variant="outline" className="border-destructive text-destructive">
              <AlertCircle className="mr-1 h-3 w-3" />
              Rejected: {f.result.rejected}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnSelectDialog({
  file,
  onClose,
  onApply,
}: {
  file: ImportFileItem | null;
  onClose: () => void;
  onApply: (excluded: string[]) => void;
}) {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.isAdmin === true;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const open = !!file;
  const headers = file?.availableHeaders ?? [];
  const isRequired = (h: string) => file?.fieldByHeader?.[h] === "doc_ref";
  useEffect(() => {
    if (!open) return;
    const next = new Set(file?.excludedHeaders ?? []);
    if (!isAdmin) {
      for (const h of headers) if (isRequired(h)) next.delete(h);
    }
    setExcluded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.id, isAdmin]);

  if (!file) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Columns to Import</DialogTitle>
          <DialogDescription>
            체크된 컬럼만 파싱됩니다. 매핑되지 않은 헤더는 raw_payload에 보존됩니다.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="space-y-2">
            {headers.map((h) => {
              const field = file.fieldByHeader?.[h];
              const sample = file.headerSamples?.[h];
              const isIncluded = !excluded.has(h);
              return (
                <label
                  key={h}
                  className="flex items-start gap-2 rounded border p-2 text-xs hover:bg-accent/40"
                >
                  <Checkbox
                    checked={isIncluded}
                    disabled={!isAdmin && isRequired(h)}
                    onCheckedChange={(checked) => {
                      if (!isAdmin && isRequired(h) && !checked) return;
                      setExcluded((cur) => {
                        const next = new Set(cur);
                        if (checked) next.delete(h);
                        else next.add(h);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{h}</span>
                      {field ? (
                        <Badge variant="secondary" className="text-[10px]">
                          → {field}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-400 text-amber-600 text-[10px]"
                        >
                          unmapped
                        </Badge>
                      )}
                      {isRequired(h) && (
                        <Badge
                          variant="outline"
                          className="border-amber-400 text-amber-700 text-[10px]"
                        >
                          필수
                        </Badge>
                      )}
                    </div>
                    {sample != null && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        e.g. {String(sample)}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(Array.from(excluded))}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}