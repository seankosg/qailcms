import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search, RefreshCcw, Upload, LayoutDashboard, FileClock } from "lucide-react";
import {
  DEFECT_COLUMNS,
  DEFECT_TEAMS,
  DEFECT_SEARCH_FIELDS,
  TEAM_COLORS,
  TEAM_FALLBACK_COLOR,
  STATUS_COLORS,
  PRIORITY_COLORS,
  type DefectColumnDef,
} from "@/lib/defect-management/columns";
import { useDefectRawData, getDefectLatestDataDate, type DefectItem } from "@/hooks/useDefectRawData";
import { useDefectFieldConfig, buildDefectLabelOverrides } from "@/hooks/useDefectFieldConfig";

function formatDate(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}
function formatDatetime(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function formatPct(v: number | null | undefined): string {
  if (v == null) return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(1)}%`;
}

function renderCell(row: DefectItem, col: DefectColumnDef) {
  const raw = (row as any)[col.key];
  if (raw == null || raw === "") return <span className="text-muted-foreground/50">—</span>;

  if (col.key === "team") {
    return <Badge className={cn("text-xs", TEAM_COLORS[String(raw)] ?? TEAM_FALLBACK_COLOR)}>{String(raw)}</Badge>;
  }
  if (col.key === "priority" || col.key === "hdec_verification") {
    const cls = PRIORITY_COLORS[String(raw)] ?? TEAM_FALLBACK_COLOR;
    return <Badge className={cn("text-xs", cls)}>{String(raw)}</Badge>;
  }
  if (col.key === "status_raw" || col.key === "completion_status" || col.key === "closure_status") {
    const cls = STATUS_COLORS[String(raw)] ?? TEAM_FALLBACK_COLOR;
    return <Badge className={cn("text-xs", cls)}>{String(raw)}</Badge>;
  }
  if (col.key === "is_critical") {
    return raw ? <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">Critical</Badge> : <span className="text-muted-foreground/50">—</span>;
  }
  if (col.type === "date") return <span className="tabular-nums text-xs">{formatDate(raw)}</span>;
  if (col.type === "datetime") return <span className="tabular-nums text-xs">{formatDatetime(raw)}</span>;
  if (col.type === "percent") return <span className="tabular-nums text-xs">{formatPct(raw)}</span>;
  if (col.type === "longtext") {
    return <span className="line-clamp-2 whitespace-pre-wrap text-xs">{String(raw)}</span>;
  }
  return <span className="text-xs">{String(raw)}</span>;
}

export function DefectRawDataPage() {
  const [teams, setTeams] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const filters = useMemo(
    () => ({ teams, status: [] as string[], q, includeInactive }),
    [teams, q, includeInactive],
  );

  const { data: items = [], isLoading, refetch, isFetching } = useDefectRawData(filters);
  const { data: fieldConfig = [] } = useDefectFieldConfig();

  const latestDataDate = getDefectLatestDataDate(items);
  const labelOverrides = buildDefectLabelOverrides(fieldConfig);
  const visibleFieldSet = useMemo(() => new Set(fieldConfig.filter((f) => f.is_visible).map((f) => f.field_name)), [fieldConfig]);
  const columns = useMemo(() => {
    // Field config에 없는 필드도 표시(seed 이후 추가된 컬럼 방어)
    const hasConfig = fieldConfig.length > 0;
    return DEFECT_COLUMNS.filter((c) => (hasConfig ? visibleFieldSet.has(c.key) : true));
  }, [fieldConfig, visibleFieldSet]);

  const toggleTeam = (t: string) => {
    setTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };
  const applySearch = () => setQ(searchInput);

  const totalRows = items.length;
  const criticalRows = items.filter((it) => it.is_critical).length;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Defect Management — Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            총 {totalRows.toLocaleString()}건 · Critical {criticalRows.toLocaleString()}건
            {latestDataDate ? ` · Latest Data Date ${latestDataDate}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/closure/defect-management/dashboard"><LayoutDashboard className="mr-1 h-3.5 w-3.5" /> Dashboard</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/closure/defect-management/import"><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/closure/defect-management/import/logs"><FileClock className="mr-1 h-3.5 w-3.5" /> Import Logs</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-1">
          {DEFECT_TEAMS.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={teams.includes(t) ? "default" : "outline"}
              onClick={() => toggleTeam(t)}
              className="h-7"
            >
              {t}
            </Button>
          ))}
          {teams.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setTeams([])} className="h-7 text-xs">Clear</Button>
          )}
        </div>
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder={`검색: ${DEFECT_SEARCH_FIELDS.slice(0, 4).join(", ")}…`}
            className="pl-7 h-8 text-sm"
          />
        </div>
        <Button size="sm" onClick={applySearch} className="h-8">검색</Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeInactive} onCheckedChange={(v) => setIncludeInactive(!!v)} />
          비활성 포함
        </label>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} style={{ minWidth: c.width }} className="text-xs whitespace-nowrap">
                  {labelOverrides[c.key] ?? c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  데이터가 없습니다. Import 페이지에서 Excel을 업로드하세요.
                </TableCell>
              </TableRow>
            )}
            {items.slice(0, 500).map((row) => (
              <TableRow key={row.id}>
                {columns.map((c) => (
                  <TableCell key={c.key} className="align-top py-2">
                    {renderCell(row, c)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items.length > 500 && (
          <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            상위 500행만 표시 중입니다 (전체 {items.length.toLocaleString()}건). 필터/검색으로 좁혀주세요. — Phase 2에서 가상화 테이블로 확장 예정.
          </div>
        )}
      </div>
    </div>
  );
}