import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDdMmm } from "@/lib/time/doha";
import { AbdEditCellPopover } from "@/components/abd/raw-data/AbdEditCellPopover";
import type { SplCatalogEntry, SplRow } from "@/lib/spl/rows.functions";
import { SPL_EDITABLE_FIELDS, splJudgmentLabel } from "./spl-columns";

interface Props {
  row: SplRow | null;
  catalog: SplCatalogEntry[];
  canEdit: boolean;
  onSave: (id: string, field: string, value: string | null) => Promise<void>;
  onOpenChange: (o: boolean) => void;
}

function d(v: string | null | undefined) {
  return v ? formatDdMmm(v) : "—";
}

export function SplDetailSheet({ row, catalog, canEdit, onSave, onOpenChange }: Props) {
  if (!row) return null;
  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{row.spl_number}</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge variant="outline">{row.plot ? `PLOT-${row.plot}` : "Plot —"}</Badge>
          <Badge variant={row.judgment === "지연" ? "destructive" : "secondary"}>{splJudgmentLabel(row.judgment)}</Badge>
          <Badge variant="outline">
            Progress {row.progress_pct == null ? "—" : `${row.progress_pct}%`} ({row.done}/{row.denom})
          </Badge>
          <Badge variant="outline">
            Req.Doc {row.req_doc_done}/{row.req_doc_total}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Title" value={row.title ?? "—"} />
          <Field label="DIS" value={row.dis ?? "—"} />
          <Field label="Service" value={row.service ?? "—"} />
          <Field label="Latest Status" value={row.latest_status ?? "—"} />
          <Field label="Supplier" value={row.supplier ?? "—"} />
          <Field label="Data Date" value={d(row.data_date)} />
          <Field
            label="Primary delay"
            value={row.primary_delay ? `${row.primary_delay.label} · ${row.primary_delay.days}d` : "—"}
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {SPL_EDITABLE_FIELDS.map((f) => (
            <div key={f.field}>
              <div className="text-[10px] uppercase text-muted-foreground">{f.label}</div>
              <AbdEditCellPopover
                id={row.id}
                field={f.field}
                label={f.label}
                editorType="text"
                currentValue={(row as any)[f.field]}
                canEdit={canEdit}
                saveFn={async (p) => onSave(row.id, p.field, p.value == null ? null : String(p.value))}
              >
                <span className="text-xs">{(row as any)[f.field] ?? "—"}</span>
              </AbdEditCellPopover>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-1 text-[11px] font-medium">Stage progress</div>
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr className="bg-muted">
                <th className="border-b px-2 py-1 text-left">Stage</th>
                <th className="border-b px-2 py-1">P.Start</th>
                <th className="border-b px-2 py-1">A.Start</th>
                <th className="border-b px-2 py-1">P.Finish</th>
                <th className="border-b px-2 py-1">A.Finish</th>
                <th className="border-b px-2 py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((s) => {
                const c = row.stages[s.stage_code];
                return (
                  <tr key={s.stage_code} className={cn(c?.na && "bg-muted/40")}>
                    <td className="border-b px-2 py-1">
                      {s.label}
                      {s.actual_authority === "ACONEX" && (
                        <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] text-emerald-800">Aconex</span>
                      )}
                    </td>
                    <td className="border-b px-2 py-1 text-center">{d(c?.ps)}</td>
                    <td className="border-b px-2 py-1 text-center">{d(c?.as)}</td>
                    <td className="border-b px-2 py-1 text-center">{d(c?.pf)}</td>
                    <td className="border-b px-2 py-1 text-center">{d(c?.af)}</td>
                    <td className="border-b px-2 py-1 text-center">{c?.na ? "NA" : (c?.fv ?? "—")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}