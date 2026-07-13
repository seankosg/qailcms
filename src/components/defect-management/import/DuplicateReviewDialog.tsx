import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  DefectImportFile,
  DuplicateStrategy,
} from "@/contexts/DefectManagementImportContext";

interface Props {
  file: DefectImportFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeStrategy: (strategy: DuplicateStrategy) => void;
  onChangeSelection: (groupKey: string, parsedIndex: number) => void;
  onConfirm: () => void;
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export function DuplicateReviewDialog({
  file,
  open,
  onOpenChange,
  onChangeStrategy,
  onChangeSelection,
  onConfirm,
}: Props) {
  const groups = file.duplicateGroups ?? [];
  const strategy = file.duplicateStrategy ?? "keep_last";
  const totalRows = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const keepCount = groups.length;
  const dropCount = totalRows - keepCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>중복 Issue No 검토 — {file.name}</DialogTitle>
          <DialogDescription>
            동일한 <code>source_issue_no</code> 를 가진 행이 <strong>{groups.length}개 그룹</strong>,
            총 <strong>{totalRows}행</strong> 감지되었습니다. 각 그룹에서 유지할 행을 선택하세요.
            {(file.autoDedupedIdenticalCount ?? 0) > 0 && (
              <> · 완전 동일 중복 <strong>{file.autoDedupedIdenticalCount}행</strong>은 자동으로 제거되었습니다.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">전략</p>
            <RadioGroup
              value={strategy}
              onValueChange={(v) => onChangeStrategy(v as DuplicateStrategy)}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="keep_last" id="dup-keep-last" />
                <Label htmlFor="dup-keep-last" className="cursor-pointer text-sm">
                  Keep last <span className="text-xs text-muted-foreground">(기본 · 각 그룹 마지막 행)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="keep_first" id="dup-keep-first" />
                <Label htmlFor="dup-keep-first" className="cursor-pointer text-sm">
                  Keep first <span className="text-xs text-muted-foreground">(각 그룹 첫 행)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="manual" id="dup-manual" />
                <Label htmlFor="dup-manual" className="cursor-pointer text-sm">
                  Manual <span className="text-xs text-muted-foreground">(그룹별 개별 선택)</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <ScrollArea className="h-[400px] rounded border">
            <div className="space-y-2 p-2">
              {groups.map((g) => (
                <div key={g.key} className="rounded border p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-mono text-sm font-semibold">{g.key}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.rows.length}행 중 1개 유지
                    </p>
                  </div>
                  <RadioGroup
                    value={String(g.selectedParsedIndex)}
                    onValueChange={(v) => onChangeSelection(g.key, Number(v))}
                    disabled={strategy !== "manual"}
                  >
                    <div className="space-y-1">
                      {g.rows.map((r, i) => {
                        const selected = g.selectedParsedIndex === r.parsedIndex;
                        return (
                          <div
                            key={r.parsedIndex}
                            className={`flex gap-2 rounded border p-2 text-xs ${
                              selected ? "border-primary bg-primary/5" : "border-transparent"
                            }`}
                          >
                            <RadioGroupItem
                              value={String(r.parsedIndex)}
                              id={`dup-${g.key}-${r.parsedIndex}`}
                              disabled={strategy !== "manual"}
                              className="mt-0.5"
                            />
                            <Label
                              htmlFor={`dup-${g.key}-${r.parsedIndex}`}
                              className={`flex-1 ${strategy === "manual" ? "cursor-pointer" : "cursor-default"}`}
                            >
                              <div className="flex items-baseline gap-2">
                                <span className="rounded bg-muted px-1.5 font-mono text-[10px]">
                                  #{i + 1}
                                </span>
                                <span className="font-medium">
                                  {fmt(r.preview.status_raw)}
                                </span>
                                <span className="text-muted-foreground">
                                  · updated: {fmt(r.preview.updated_date_raw)}
                                </span>
                                <span className="text-muted-foreground">
                                  · by: {fmt(r.preview.updated_by_name)}
                                </span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-muted-foreground">
                                {fmt(r.preview.description)}
                              </div>
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </RadioGroup>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            유지 <strong>{keepCount}</strong>건 · 폐기 <strong>{dropCount}</strong>건
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={onConfirm}>확인 (중복 해결)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}