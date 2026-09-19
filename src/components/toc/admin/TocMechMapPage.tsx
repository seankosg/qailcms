import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Save } from "lucide-react";
import { getTocMechMap, saveTocMechMap, type TocMechMapRow } from "@/lib/toc/mech-map.functions";
import { parseMechTcFile } from "@/lib/toc/mech-tc-parser";

type Combo = {
  source_system: string;
  source_description: string;
  label: string;
  /** 파일의 SOW_Mech 값 (후보. 저장해야 규칙이 된다) */
  candidate?: string | null;
};

const NONE = "__none__";

/**
 * 설비 T&C 파일의 시스템·설명 조합을 인계(TOC) 항목 키에 연결하는 대응표 화면.
 * 대응표가 유일한 매칭 근거이므로, 표에 없는 조합은 갱신할 때 "미연결"로 노출된다.
 */
export function TocMechMapPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileCombos, setFileCombos] = useState<Combo[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<null | "parse" | "save">(null);

  const fetchMap = useServerFn(getTocMechMap);
  const save = useServerFn(saveTocMechMap);
  const data = useQuery({ queryKey: ["toc-mech-map"], queryFn: () => fetchMap({}), staleTime: 30_000 });

  const key = (c: { source_system: string; source_description: string }) => `${c.source_system}|${c.source_description}`;

  const saved = useMemo(() => {
    const m = new Map<string, TocMechMapRow>();
    for (const r of data.data?.map ?? []) m.set(key(r as any), r);
    return m;
  }, [data.data]);

  const items = data.data?.items ?? [];
  const canWrite = data.data?.can_write ?? false;

  /** 항목 이름(sub_system) → 항목 키. 파일의 SOW_Mech 후보를 풀 때만 쓴다. */
  const byName = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) if (it.sub_system) m.set(it.sub_system.trim().toLowerCase(), it.item_key);
    return m;
  }, [items]);

  const combos = useMemo(() => {
    const m = new Map<string, Combo>();
    for (const r of data.data?.map ?? []) {
      m.set(key(r as any), {
        source_system: r.source_system,
        source_description: r.source_description,
        label: [r.source_system, r.source_description].filter(Boolean).join(" / "),
      });
    }
    for (const c of fileCombos) m.set(key(c), { ...m.get(key(c)), ...c });
    const list = Array.from(m.values());
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((c) => c.label.toLowerCase().includes(needle)) : list;
  }, [data.data, fileCombos, q]);

  const current = (c: Combo) => edits[key(c)] ?? saved.get(key(c))?.item_key ?? NONE;
  const linkedCount = combos.filter((c) => current(c) !== NONE).length;

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy("parse");
    try {
      const p = await parseMechTcFile(file);
      const m = new Map<string, Combo>();
      for (const r of p.rows) {
        m.set(key(r), {
          source_system: r.source_system,
          source_description: r.source_description,
          label: [r.source_system, r.source_description].filter(Boolean).join(" / "),
          candidate: r.sow_candidate,
        });
      }
      setFileCombos(Array.from(m.values()));
      toast.success(`파일에서 ${m.size}개 조합을 읽었습니다`);
    } catch (e: any) {
      toast.error(e?.message ?? "파일을 읽지 못했습니다");
    } finally {
      setBusy(null);
    }
  }

  function applyCandidates() {
    const next: Record<string, string> = {};
    for (const c of combos) {
      if (current(c) !== NONE || !c.candidate) continue;
      const k = byName.get(c.candidate.trim().toLowerCase());
      if (k) next[key(c)] = k;
    }
    if (Object.keys(next).length === 0) {
      toast.info("적용할 후보가 없습니다");
      return;
    }
    setEdits((p) => ({ ...p, ...next }));
    toast.success(`후보 ${Object.keys(next).length}건을 채웠습니다. 저장해야 규칙이 됩니다.`);
  }

  async function onSave() {
    const rows = Object.entries(edits).map(([k, v]) => {
      const [source_system = "", source_description = ""] = k.split("|");
      return {
        plot: "D" as const,
        source_system,
        source_description,
        item_key: v === NONE ? null : v,
        is_active: true,
        note: null,
      };
    });
    if (rows.length === 0) {
      toast.info("변경된 연결이 없습니다");
      return;
    }
    setBusy("save");
    try {
      const res = await save({ data: { rows } });
      toast.success(`저장 완료 — 연결 ${res.saved}건, 해제 ${res.cleared}건`);
      setEdits({});
      await data.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">설비 T&amp;C 대응표</h1>
        <p className="text-sm text-muted-foreground">
          설비 T&amp;C 잔여 파일의 시스템·설명 조합을 인계 항목에 연결합니다. 여기에 없는 조합은 갱신할 때 "미연결"로
          표시됩니다. 파일에 적힌 이름은 후보로만 보여주며, 저장해야 규칙이 됩니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">연결</CardTitle>
          <CardDescription>
            조합 {combos.length}개 · 연결됨 {linkedCount}개 · 미연결 {combos.length - linkedCount}개 · 설비 항목 {items.length}개
            {!canWrite && <Badge variant="secondary" className="ml-2">읽기 전용</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === "parse" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              파일에서 조합 불러오기
            </Button>
            <Button variant="outline" onClick={applyCandidates} disabled={!canWrite || fileCombos.length === 0}>
              파일 후보로 채우기
            </Button>
            <Input placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
            <Button onClick={onSave} disabled={!canWrite || busy !== null || Object.keys(edits).length === 0}>
              {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              저장 ({Object.keys(edits).length})
            </Button>
          </div>

          {data.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>
          ) : (
            <ScrollArea className="max-h-[32rem] rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">파일 조합</th>
                    <th className="p-2 text-left">파일 후보</th>
                    <th className="p-2 text-left">인계 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((c) => {
                    const v = current(c);
                    const candKey = c.candidate ? byName.get(c.candidate.trim().toLowerCase()) : undefined;
                    const mismatch = v !== NONE && candKey != null && candKey !== v;
                    return (
                      <tr key={key(c)} className="border-t">
                        <td className="p-2 align-middle">
                          {c.label}
                          {v === NONE && (
                            <Badge variant="destructive" className="ml-2">
                              미연결
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 align-middle text-muted-foreground">
                          {c.candidate ?? "—"}
                          {mismatch && (
                            <Badge variant="outline" className="ml-2">
                              대응표와 다름
                            </Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <Select
                            value={v}
                            disabled={!canWrite}
                            onValueChange={(nv) => setEdits((p) => ({ ...p, [key(c)]: nv }))}
                          >
                            <SelectTrigger className="w-[28rem]">
                              <SelectValue placeholder="선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>(연결 없음)</SelectItem>
                              {items.map((it) => (
                                <SelectItem key={it.item_key} value={it.item_key}>
                                  {it.item_key} — {it.sub_system ?? it.main_system ?? ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                  {combos.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-muted-foreground">
                        설비 T&amp;C 파일을 불러오면 연결할 조합이 표시됩니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
