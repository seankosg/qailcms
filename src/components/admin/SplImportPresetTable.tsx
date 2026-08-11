import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSplFieldConfig, useSplFieldHelpers } from "@/hooks/useSplFieldConfig";
import { useSplHeaderMappings } from "@/hooks/useSplHeaderMappings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowUp, Plus, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export type SplPresetMode = "hdec" | "aconex";

interface Preset {
  id: string;
  mode: SplPresetMode;
  label: string;
  fields: string[];
  sort_order: number;
}

export const SPL_IMPORT_PRESETS_QK = ["spl-import-presets"] as const;

/** Aconex 시딩본이 SPL 로 반영하는 필드 (라벨 폴백용). */
export const SPL_ACONEX_SYNC_FIELDS: Array<{ field: string; label: string }> = [
  { field: "spl_number", label: "SPL NUMBER" },
  { field: "dis", label: "DIS" },
  { field: "service", label: "Service" },
  { field: "title", label: "Title" },
  { field: "revision", label: "Revision" },
  { field: "latest_status", label: "Latest Status" },
  { field: "approval_status_raw", label: "Approval Status (원본)" },
  { field: "stage:APPROVAL_DATE|as", label: "D-AP · Approval date — Actual Date" },
];

/** Aconex 정본 fallback 헤더 → 반영 필드 (Header Mapping 에 없어도 항상 노출). */
export const SPL_ACONEX_CANONICAL_HEADER_TO_FIELDS: Record<string, string[]> = {
  "Document No": [],
  DIS: ["dis"],
  Service: ["service"],
  "Document Title": ["title"],
  Revision: ["revision"],
  Status: ["latest_status"],
  "Approval Status": ["approval_status_raw"],
  "Approval Date": ["stage:APPROVAL_DATE|as"],
};
const SPL_ACONEX_UNIQUE_HEADER = "Document No";

type AconexFieldOption = {
  field: string; // = 원본 헤더 문자열 (dedup key)
  label: string;
  targets: string[];
  forms: string[];
  isCanonical: boolean;
};

export function SplImportPresetTable({ mode }: { mode: SplPresetMode }) {
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const canEdit = currentUser?.isAdmin === true || currentUser?.isDSuperUser === true;

  const { data: fieldConfig = [] } = useSplFieldConfig();
  const { getLabel: getSplLabel } = useSplFieldHelpers();
  const { data: headerMappings = [] } = useSplHeaderMappings();

  const aconexOptions = useMemo<AconexFieldOption[]>(() => {
    const map = new Map<string, AconexFieldOption>();
    for (const [header, targets] of Object.entries(SPL_ACONEX_CANONICAL_HEADER_TO_FIELDS)) {
      map.set(header, { field: header, label: header, targets: [...targets], forms: [], isCanonical: true });
    }
    for (const row of headerMappings) {
      if (!row.is_active) continue;
      if (row.form !== "ACONEX") continue;
      const header = row.source_header?.trim();
      const t = row.target_field;
      if (!header || !t) continue;
      const exist = map.get(header);
      if (exist) {
        if (!exist.targets.includes(t)) exist.targets.push(t);
        if (!exist.forms.includes(row.form)) exist.forms.push(row.form);
      } else {
        map.set(header, { field: header, label: header, targets: [t], forms: [row.form], isCanonical: false });
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (a.field === SPL_ACONEX_UNIQUE_HEADER) return -1;
      if (b.field === SPL_ACONEX_UNIQUE_HEADER) return 1;
      return a.field.localeCompare(b.field);
    });
    return arr;
  }, [headerMappings]);

  const fieldOptions = useMemo<Array<{ field: string; label: string }>>(() => {
    if (mode === "aconex") return aconexOptions.map((o) => ({ field: o.field, label: o.label }));
    return fieldConfig
      .slice()
      .filter((r) => r.source_group !== "system")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ field: r.field_key, label: r.label || r.field_key }));
  }, [mode, fieldConfig, aconexOptions]);

  const systemFieldToHeaders = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const opt of aconexOptions) {
      for (const t of opt.targets) {
        const arr = m.get(t) ?? [];
        if (!arr.includes(opt.field)) arr.push(opt.field);
        m.set(t, arr);
      }
    }
    return m;
  }, [aconexOptions]);

  const normalizePresetFields = (fields: string[]): string[] => {
    if (mode !== "aconex") return fields;
    const headerSet = new Set(aconexOptions.map((o) => o.field));
    const out = new Set<string>();
    for (const f of fields) {
      if (headerSet.has(f)) { out.add(f); continue; }
      const mapped = systemFieldToHeaders.get(f);
      if (mapped) for (const h of mapped) out.add(h);
    }
    return Array.from(out);
  };

  const getLabel = (f: string): string => {
    if (mode === "aconex") {
      const opt = aconexOptions.find((o) => o.field === f);
      if (opt) return opt.label;
      return SPL_ACONEX_SYNC_FIELDS.find((o) => o.field === f)?.label ?? f;
    }
    return getSplLabel(f);
  };

  const getOptionMeta = (f: string): { targets: string[]; teams: string[]; isCanonical: boolean } | null => {
    if (mode !== "aconex") return null;
    const o = aconexOptions.find((x) => x.field === f);
    return o ? { targets: o.targets, teams: o.forms, isCanonical: o.isCanonical } : null;
  };

  const { data: presets = [], isLoading } = useQuery({
    queryKey: [...SPL_IMPORT_PRESETS_QK, mode],
    queryFn: async (): Promise<Preset[]> => {
      const { data, error } = await (supabase as any)
        .from("spl_import_presets")
        .select("*")
        .eq("mode", mode)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Preset[];
    },
    staleTime: 10_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: SPL_IMPORT_PRESETS_QK });

  const addMutation = useMutation({
    mutationFn: async () => {
      const nextOrder = (presets.reduce((m, p) => Math.max(m, p.sort_order), 0) || 0) + 10;
      const { error } = await (supabase as any)
        .from("spl_import_presets")
        .insert({ mode, label: "New Preset", fields: [], sort_order: nextOrder });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("프리셋이 추가되었습니다"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "추가 실패"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; patch: Partial<Pick<Preset, "label" | "fields" | "sort_order">> }) => {
      const { error } = await (supabase as any).from("spl_import_presets").update(payload.patch).eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e.message ?? "저장 실패"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("spl_import_presets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("프리셋이 삭제되었습니다"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "삭제 실패"),
  });

  const swapOrder = async (aIdx: number, bIdx: number) => {
    const a = presets[aIdx];
    const b = presets[bIdx];
    if (!a || !b) return;
    await Promise.all([
      updateMutation.mutateAsync({ id: a.id, patch: { sort_order: b.sort_order } }),
      updateMutation.mutateAsync({ id: b.id, patch: { sort_order: a.sort_order } }),
    ]);
  };

  const [deleteTarget, setDeleteTarget] = useState<Preset | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          SPL Import 화면 상단의 프리셋 버튼을 관리합니다 ({mode === "hdec" ? "HDEC 모드" : "Aconex 모드"} 전용).
          라벨(버튼 이름), 포함할 필드, 표시 순서를 설정하면 다음 임포트부터 즉시 반영됩니다.
        </p>
        <Button size="sm" onClick={() => addMutation.mutate()} disabled={!canEdit || addMutation.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Preset 추가
        </Button>
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-[36px_1fr_2fr_140px] gap-2 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          <div>#</div>
          <div>라벨 (버튼 이름)</div>
          <div>포함 필드</div>
          <div className="text-right">작업</div>
        </div>
        {isLoading ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">로딩 중…</div>
        ) : presets.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">등록된 프리셋이 없습니다.</div>
        ) : (
          presets.map((p, idx) => (
            <PresetRow
              key={p.id}
              preset={p}
              index={idx}
              total={presets.length}
              canEdit={canEdit}
              fieldOptions={fieldOptions}
              getLabel={getLabel}
              getOptionMeta={getOptionMeta}
              normalizeFields={normalizePresetFields}
              lockedField={mode === "aconex" ? SPL_ACONEX_UNIQUE_HEADER : null}
              onLabelChange={(label) => updateMutation.mutate({ id: p.id, patch: { label } })}
              onFieldsChange={(fields) => updateMutation.mutate({ id: p.id, patch: { fields } })}
              onMoveUp={() => swapOrder(idx, idx - 1)}
              onMoveDown={() => swapOrder(idx, idx + 1)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>프리셋 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.label}&quot; 프리셋을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PresetRow({
  preset,
  index,
  total,
  canEdit,
  fieldOptions,
  getLabel,
  getOptionMeta,
  normalizeFields,
  lockedField,
  onLabelChange,
  onFieldsChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  preset: Preset;
  index: number;
  total: number;
  canEdit: boolean;
  fieldOptions: Array<{ field: string; label: string }>;
  getLabel: (f: string) => string;
  getOptionMeta: (f: string) => { targets: string[]; teams: string[]; isCanonical: boolean } | null;
  normalizeFields: (fields: string[]) => string[];
  lockedField: string | null;
  onLabelChange: (label: string) => void;
  onFieldsChange: (fields: string[]) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [labelDraft, setLabelDraft] = useState(preset.label);
  const [search, setSearch] = useState("");

  const normalized = useMemo(() => normalizeFields(preset.fields), [preset.fields, normalizeFields]);
  const selected = new Set<string>(normalized);
  if (lockedField) selected.add(lockedField);
  const filteredOptions = fieldOptions.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const meta = getOptionMeta(o.field);
    return (
      o.field.toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (meta?.targets ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });

  const toggle = (field: string) => {
    if (lockedField && field === lockedField) return;
    const next = new Set(selected);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    if (lockedField) next.add(lockedField);
    onFieldsChange(Array.from(next));
  };

  return (
    <div className="grid grid-cols-[36px_1fr_2fr_140px] gap-2 items-start border-b px-3 py-2 last:border-b-0">
      <div className="text-xs text-muted-foreground pt-2">{index + 1}</div>
      <div>
        <Input
          value={labelDraft}
          disabled={!canEdit}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            if (labelDraft.trim() && labelDraft !== preset.label) onLabelChange(labelDraft.trim());
            else if (!labelDraft.trim()) setLabelDraft(preset.label);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setLabelDraft(preset.label); (e.target as HTMLInputElement).blur(); }
          }}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {selected.size === 0 ? (
          <span className="text-xs text-muted-foreground italic">필드가 선택되지 않았습니다</span>
        ) : (
          Array.from(selected).map((f) => (
            <Badge key={f} variant="secondary" className="text-[10px]">
              {getLabel(f)}
              {lockedField === f && <span className="ml-1 opacity-60">🔒</span>}
            </Badge>
          ))
        )}
        {canEdit && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-6 text-xs">필드 편집</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="필드 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-7 text-xs"
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-auto p-1">
                {filteredOptions.map((o) => {
                  const checked = selected.has(o.field);
                  const meta = getOptionMeta(o.field);
                  const isLocked = lockedField === o.field;
                  return (
                    <label
                      key={o.field}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs ${isLocked ? "opacity-90 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <Checkbox checked={checked} disabled={isLocked} onCheckedChange={() => toggle(o.field)} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-medium">{o.label}</span>
                          {isLocked && <span className="text-[9px] text-muted-foreground">(유니크 키)</span>}
                          {meta && meta.teams.length > 0 && (
                            <span className="text-[9px] text-muted-foreground">[{meta.teams.join("/")}]</span>
                          )}
                        </div>
                        {meta && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            {meta.targets.length === 0
                              ? isLocked
                                ? "→ 매칭 유니크 키"
                                : "→ (미매핑 — 임포트 시 무시됨)"
                              : `→ ${meta.targets.join(", ")}`}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {filteredOptions.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">일치하는 필드가 없습니다</div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit || index === 0} onClick={onMoveUp} title="위로">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit || index === total - 1} onClick={onMoveDown} title="아래로">
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canEdit} onClick={onDelete} title="삭제">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
