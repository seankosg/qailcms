import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  SPARE_PART_COLUMNS,
  APPROVAL_CODE_COLORS,
  PLOT_COLORS,
  type SparePartColumnDef,
} from "@/lib/spare-part/columns";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useSparePartFieldConfig,
  buildLabelOverrides,
} from "@/hooks/useSparePartFieldConfig";
import { FieldRenderer } from "./FieldRenderer";
import { SparePartStatusHistory } from "./SparePartStatusHistory";

const GROUP_ORDER: Array<{ key: SparePartColumnDef["group"]; title: string }> = [
  { key: "id", title: "Identification" },
  { key: "vendor", title: "Vendor" },
  { key: "approval", title: "Approval" },
  { key: "qty", title: "Quantity" },
  { key: "cost", title: "Cost" },
  { key: "spl", title: "SPL" },
  { key: "avail", title: "Availability" },
  { key: "stage", title: "Procurement Stages" },
  { key: "delivery", title: "Delivery" },
  { key: "issue", title: "Issues (legacy fields)" },
  { key: "remark", title: "Remarks" },
  { key: "system", title: "System" },
];

const READONLY_KEYS = new Set(["doc_ref"]);

function normalizeValue(v: unknown): unknown {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v ?? null;
}

interface Props {
  docRef: string;
}

export function SparePartDetailPage({ docRef }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: fieldConfig } = useSparePartFieldConfig();
  const labelOverrides = useMemo(() => buildLabelOverrides(fieldConfig), [fieldConfig]);

  const canEdit = !!user?.isAdmin;

  const { data: record, isLoading, refetch } = useQuery({
    queryKey: ["spare-part-detail", docRef],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("spare_parts_raw")
        .select("*")
        .eq("doc_ref", docRef)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (record) setForm({ ...record });
  }, [record]);

  const dirtyKeys = useMemo(() => {
    if (!record) return [];
    const keys: string[] = [];
    for (const c of SPARE_PART_COLUMNS) {
      if (READONLY_KEYS.has(c.key)) continue;
      const a = normalizeValue((record as any)[c.key]);
      const b = normalizeValue(form[c.key]);
      if (String(a ?? "") !== String(b ?? "")) keys.push(c.key);
    }
    return keys;
  }, [record, form]);

  const setField = (key: string, v: unknown) => setForm((cur) => ({ ...cur, [key]: v }));

  const handleSave = async () => {
    if (!record || !canEdit || dirtyKeys.length === 0) return;
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const k of dirtyKeys) payload[k] = normalizeValue(form[k]);
    payload.updated_by = user?.id ?? null;
    const { error } = await (supabase as any)
      .from("spare_parts_raw")
      .update(payload)
      .eq("doc_ref", docRef);
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success(`Saved (${dirtyKeys.length} field${dirtyKeys.length > 1 ? "s" : ""})`);
    qc.invalidateQueries({ queryKey: ["spare-parts-raw"] });
    refetch();
  };

  const handleReset = () => {
    if (record) setForm({ ...record });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (!record) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-3">
        <Link to="/closure/spare-part/raw-data" className="text-xs text-muted-foreground hover:underline">
          ← Raw Data
        </Link>
        <h1 className="text-lg font-semibold">Record not found</h1>
        <p className="text-sm text-muted-foreground">Doc Ref: <span className="font-mono">{docRef}</span></p>
      </div>
    );
  }

  const plot = String(record.plot ?? "");
  const approval = String(record.approval_code ?? "");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/closure/spare-part/raw-data" })}
          className="h-7 px-2"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Raw Data
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight font-mono">{String(record.doc_ref)}</h1>
            {plot && (
              <Badge className={PLOT_COLORS[plot] ?? "bg-muted"}>{plot}</Badge>
            )}
            {approval && (
              <Badge className={APPROVAL_CODE_COLORS[approval] ?? "bg-muted"}>{approval}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{String(record.subject ?? "")}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={dirtyKeys.length === 0 || saving}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={dirtyKeys.length === 0 || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save {dirtyKeys.length > 0 ? `(${dirtyKeys.length})` : ""}
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Read-only view. Admin permission required to edit fields.
        </p>
      )}

      <Separator />

      {GROUP_ORDER.map(({ key: groupKey, title }) => {
        const cols = SPARE_PART_COLUMNS.filter((c) => c.group === groupKey);
        if (cols.length === 0) return null;
        return (
          <Card key={groupKey}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cols.map((c) => (
                <FieldRenderer
                  key={c.key}
                  col={c}
                  label={labelOverrides[c.key] ?? c.label}
                  value={form[c.key]}
                  disabled={!canEdit || READONLY_KEYS.has(c.key)}
                  onChange={(v) => setField(c.key, v)}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Status History</CardTitle>
        </CardHeader>
        <CardContent>
          <SparePartStatusHistory docRef={docRef} />
        </CardContent>
      </Card>
    </div>
  );
}