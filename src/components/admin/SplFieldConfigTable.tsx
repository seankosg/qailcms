import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { SPL_HEADER_MAPPING_QK } from "@/hooks/useSplHeaderMappings";
import { SPL_FIELD_CONFIG_QK } from "@/hooks/useSplFieldConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FieldConfig {
  id: string;
  field_key: string;
  label: string;
  group: string | null;
  data_type: string;
  editable: boolean;
  visible: boolean;
  sort_order: number;
}

export function SplFieldConfigTable() {
  const [rows, setRows] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("spl_field_config").select("*").order("sort_order", { ascending: true });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.field_key.toLowerCase().includes(s) || r.label.toLowerCase().includes(s));
  }, [rows, search]);

  const patch = async (r: FieldConfig, changes: Partial<FieldConfig>) => {
    const { error } = await (supabase as any).from("spl_field_config").update(changes).eq("id", r.id);
    if (error) { toast.error("저장 실패", { description: error.message }); return; }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...changes } : x)));
    qc.invalidateQueries({ queryKey: SPL_HEADER_MAPPING_QK });
    qc.invalidateQueries({ queryKey: SPL_FIELD_CONFIG_QK });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 justify-between">
          <CardTitle className="text-sm">Field Config ({rows.length})</CardTitle>
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 text-xs" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-16">#</TableHead>
                <TableHead className="text-xs">Field Key</TableHead>
                <TableHead className="text-xs">Label</TableHead>
                <TableHead className="text-xs">Group</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Visible</TableHead>
                <TableHead className="text-xs">Editable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">필드 설정이 없습니다.</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs tabular-nums">{r.sort_order}</TableCell>
                  <TableCell className="text-xs font-mono">{r.field_key}</TableCell>
                  <TableCell className="text-xs">
                    <Input defaultValue={r.label} className="h-7 text-xs"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.label) void patch(r, { label: v }); }} />
                  </TableCell>
                  <TableCell className="text-xs">{r.group ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.data_type}</TableCell>
                  <TableCell><Switch checked={r.visible} onCheckedChange={(v) => patch(r, { visible: v })} /></TableCell>
                  <TableCell><Switch checked={r.editable} onCheckedChange={(v) => patch(r, { editable: v })} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
