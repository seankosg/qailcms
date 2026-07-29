import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAbdFieldConfig, useAbdFieldHelpers } from "@/hooks/useAbdFieldConfig";
import { useAbdHeaderMappings } from "@/hooks/useAbdHeaderMappings";
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

export type AbdPresetMode = "hdec" | "aconex";

interface Preset {
  id: string;
  mode: AbdPresetMode;
  label: string;
  fields: string[];
  sort_order: number;
}

export const ABD_IMPORT_PRESETS_QK = ["abd-import-presets"] as const;

/** Aconex Sync 대상 6개 필드 (AbdImportPage 와 동일 목록). */
export const ABD_ACONEX_SYNC_FIELDS: Array<{ field: string; label: string }> = [
  { field: "latest_status", label: "Latest Status" },
  { field: "latest_rev", label: "Latest Rev" },
  { field: "approval_date", label: "Approval Date" },
  { field: "aconex_status_raw", label: "Aconex Status (원본)" },
  { field: "aconex_review_status_raw", label: "Aconex Review Status (원본)" },
  { field: "aconex_date_modified", label: "Aconex Date Modified" },
  { field: "dar_response", label: "라운드 Actual (Submission / DAR)" },
  { field: "is_terminated", label: "Terminated/Cancelled 통계 제외" },
];

/**
 * Aconex Excel 원본 헤더 → 반영되는 sync 필드 매핑.
 * `AbdAconexImportPage` 의 `ACONEX_HEADER_TO_FIELDS` 와 동일 규칙 (canonical key).
 * Preset 관리 화면에서 fallback 표시 및 시스템 필드 → 원본 헤더 역매핑에 사용.
 */
export const ABD_ACONEX_CANONICAL_HEADER_TO_FIELDS: Record<string, string[]> = {
  "Document No": [],
  Revision: ["latest_rev"],
  Status: [
    "latest_status",
    "approval_date",
    "aconex_status_raw",
    "dar_response",
    "is_terminated",
  ],
  "Review Status": ["aconex_review_status_raw", "dar_response", "is_terminated"],
  "Date Modified": ["aconex_date_modified", "dar_response", "approval_date"],
};
const ABD_ACONEX_UNIQUE_HEADER = "Document No";
/** Aconex 계열로 인정할 시스템 target_field 집합. */
const ABD_ACONEX_TARGET_FIELDS = new Set<string>([
  "latest_status",
  "latest_rev",
  "approval_date",
  "aconex_status_raw",
  "aconex_review_status_raw",
  "aconex_date_modified",
  "round_actual",
  "is_terminated",
]);
function isAconexRoundActual(field: string): boolean {
  return /^r\d+_dar_actual$/i.test(field);
}

type AconexFieldOption = {
  field: string; // = original header string (dedup key)
  label: string;
  targets: string[]; // system field keys the header maps to
  teams: string[];
  isCanonical: boolean;
};

export function AbdImportPresetTable({ mode }: { mode: AbdPresetMode }) {
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const canEdit =
    currentUser?.isAdmin === true || currentUser?.isDSuperUser === true;

  const { data: fieldConfig = [] } = useAbdFieldConfig();
  const { getLabel: getAbdLabel } = useAbdFieldHelpers();
  const { data: headerMappings = [] } = useAbdHeaderMappings();

  const aconexOptions = useMemo<AconexFieldOption[]>(() => {
    const map = new Map<string, AconexFieldOption>();
    // 1) Canonical 5 fallback headers — 항상 노출
    for (const [header, targets] of Object.entries(
      ABD_ACONEX_CANONICAL_HEADER_TO_FIELDS,
    )) {
      map.set(header, {
        field: header,
        label: header,
        targets: [...targets],
        teams: [],
        isCanonical: true,
      });
    }
    // 2) Header Mapping 에서 Aconex 계열 target_field 로 등록된 원본 헤더
    for (const row of headerMappings) {
      if (!row.is_active) continue;
      const t = row.target_field;
      if (!t) continue;
      if (!ABD_ACONEX_TARGET_FIELDS.has(t) && !isAconexRoundActual(t)) continue;
      const header = row.source_header?.trim();
      if (!header) continue;
      const exist = map.get(header);
      if (exist) {
        if (!exist.targets.includes(t)) exist.targets.push(t);
        if (row.team && !exist.teams.includes(row.team)) exist.teams.push(row.team);
      } else {
        map.set(header, {
          field: header,
          label: header,
          targets: [t],
          teams: row.team ? [row.team] : [],
          isCanonical: false,
        });
      }
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (a.field === ABD_ACONEX_UNIQUE_HEADER) return -1;
      if (b.field === ABD_ACONEX_UNIQUE_HEADER) return 1;
      return a.field.localeCompare(b.field);
    });
    return arr;
  }, [headerMappings]);

  const fieldOptions = useMemo<Array<{ field: string; label: string }>>(() => {
    if (mode === "aconex") {
      return aconexOptions.map((o) => ({ field: o.field, label: o.label }));
    }
    return fieldConfig
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ field: r.field_key, label: r.label || r.field_key }));
  }, [mode, fieldConfig, aconexOptions]);

  /** 시스템 필드 키 → 원본 헤더 목록 (하위호환 초기값 복원용). */
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

  /** 저장값을 편집 selected 세트로 정규화 (원본 헤더 기준). */
  const normalizePresetFields = (fields: string[]): string[] => {
    if (mode !== "aconex") return fields;
    const headerSet = new Set(aconexOptions.map((o) => o.field));
    const out = new Set<string>();
    for (const f of fields) {
      if (headerSet.has(f)) {
        out.add(f);
        continue;
      }
      // 시스템 필드 키 → 헤더 역매핑
      const mapped = systemFieldToHeaders.get(f);
      if (mapped) for (const h of mapped) out.add(h);
    }
    return Array.from(out);
  };

  const getLabel = (f: string): string => {
    if (mode === "aconex") {
      // 이미 헤더 문자열이면 그대로
      const opt = aconexOptions.find((o) => o.field === f);
      if (opt) return opt.label;
      // 시스템 필드 키가 저장돼 있던 경우 라벨 폴백
      return ABD_ACONEX_SYNC_FIELDS.find((o) => o.field === f)?.label ?? f;
    }
    return getAbdLabel(f);
  };

  const getOptionMeta = (
    f: string,
  ): { targets: string[]; teams: string[]; isCanonical: boolean } | null => {
    if (mode !== "aconex") return null;
    return aconexOptions.find((o) => o.field === f) ?? null;
  };

  const { data: presets = [], isLoading } = useQuery({
    queryKey: [...ABD_IMPORT_PRESETS_QK, mode],
    queryFn: async (): Promise<Preset[]> => {
      const { data, error } = await (supabase as any)
        .from("abd_import_presets")
        .select("*")
        .eq("mode", mode)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Preset[];
    },
    staleTime: 10_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ABD_IMPORT_PRESETS_QK });

  const addMutation = useMutation({
    mutationFn: async () => {
      const nextOrder =
        (presets.reduce((m, p) => Math.max(m, p.sort_order), 0) || 0) + 10;
      const { error } = await (supabase as any)
        .from("abd_import_presets")
        .insert({ mode, label: "New Preset", fields: [], sort_order: nextOrder });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("프리셋이 추가되었습니다");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "추가 실패"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      patch: Partial<Pick<Preset, "label" | "fields" | "sort_order">>;
    }) => {
      const { error } = await (supabase as any)
        .from("abd_import_presets")
        .update(payload.patch)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e.message ?? "저장 실패"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("abd_import_presets")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("프리셋이 삭제되었습니다");
      invalidate();
    },
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
          ABD Import 화면 상단의 프리셋 버튼을 관리합니다 (
          {mode === "hdec" ? "HDEC 모드" : "Aconex 모드"} 전용). 라벨(버튼 이름),
          포함할 필드, 표시 순서를 설정하면 다음 임포트부터 즉시 반영됩니다.
        </p>
        <Button
          size="sm"
          onClick={() => addMutation.mutate()}
          disabled={!canEdit || addMutation.isPending}
        >
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
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            로딩 중…
          </div>
        ) : presets.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            등록된 프리셋이 없습니다.
          </div>
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
              lockedField={mode === "aconex" ? ABD_ACONEX_UNIQUE_HEADER : null}
              onLabelChange={(label) =>
                updateMutation.mutate({ id: p.id, patch: { label } })
              }
              onFieldsChange={(fields) =>
                updateMutation.mutate({ id: p.id, patch: { fields } })
              }
              onMoveUp={() => swapOrder(idx, idx - 1)}
              onMoveDown={() => swapOrder(idx, idx + 1)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))
        )}
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>프리셋 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.label}&quot; 프리셋을 삭제하시겠습니까? 이
              작업은 되돌릴 수 없습니다.
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
  getOptionMeta: (
    f: string,
  ) => { targets: string[]; teams: string[]; isCanonical: boolean } | null;
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

  const normalized = useMemo(
    () => normalizeFields(preset.fields),
    [preset.fields, normalizeFields],
  );
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
            if (labelDraft.trim() && labelDraft !== preset.label) {
              onLabelChange(labelDraft.trim());
            } else if (!labelDraft.trim()) {
              setLabelDraft(preset.label);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setLabelDraft(preset.label);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {selected.size === 0 ? (
          <span className="text-xs text-muted-foreground italic">
            필드가 선택되지 않았습니다
          </span>
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
              <Button size="sm" variant="outline" className="h-6 text-xs">
                필드 편집
              </Button>
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
                      <Checkbox
                        checked={checked}
                        disabled={isLocked}
                        onCheckedChange={() => toggle(o.field)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-medium">{o.label}</span>
                          {isLocked && (
                            <span className="text-[9px] text-muted-foreground">
                              (유니크 키)
                            </span>
                          )}
                          {meta && meta.teams.length > 0 && (
                            <span className="text-[9px] text-muted-foreground">
                              [{meta.teams.join("/")}]
                            </span>
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
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    일치하는 필드가 없습니다
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canEdit || index === 0}
          onClick={onMoveUp}
          title="위로"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canEdit || index === total - 1}
          onClick={onMoveDown}
          title="아래로"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive"
          disabled={!canEdit}
          onClick={onDelete}
          title="삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}