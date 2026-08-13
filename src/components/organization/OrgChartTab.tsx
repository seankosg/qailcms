/**
 * Organization > Organization Chart
 * HDEC PIC 마스터를 기준으로 한 조직도. 최상위는 직책이 "PD"인 인원(Project Director).
 * 계층: PD → 팀(team_master) → 팀원(상급자 지정 시 하위로 중첩).
 * 레이아웃·노드 스타일은 참조 조직도 화면과 동일한 트리 커넥터 방식.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, User, Crown, RefreshCw, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { OrgPicEditDialog } from "./OrgPicEditDialog";
import type { OrgPic } from "./org-chart-consts";

interface Team { id: string; code: string; name: string; sort_order: number; target_headcount: number }

const sortPics = (a: OrgPic, b: OrgPic) =>
  (a.sort_order - b.sort_order) ||
  ((a.rank_level ?? 999) - (b.rank_level ?? 999)) ||
  a.name.localeCompare(b.name);

export function OrgChartTab() {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const canManage = !!me && (me.isSystemAdmin || me.isAdmin || me.isSuperUser);
  const [editPic, setEditPic] = useState<OrgPic | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const picsQ = useQuery<OrgPic[]>({
    queryKey: ["org-chart", "pics"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hdec_pic_name_master")
        .select("id,name,is_active,merged_into_id,duty_title,rank_title,rank_level,team_code,parent_pic_id,sort_order")
        .is("merged_into_id", null)
        .eq("is_active", true)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as OrgPic[];
    },
  });

  const teamsQ = useQuery<Team[]>({
    queryKey: ["org-chart", "teams"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("team_master")
        .select("id,code,name,sort_order,target_headcount")
        .eq("is_active", true)
        .order("sort_order")
        .order("code");
      if (error) throw new Error(error.message);
      return (data ?? []) as Team[];
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["org-chart"] });
    setRefreshing(false);
  };

  const pics = picsQ.data ?? [];
  const teams = teamsQ.data ?? [];

  const pd = useMemo(() => pics.find((p) => (p.duty_title ?? "").toUpperCase() === "PD") ?? null, [pics]);
  const members = useMemo(() => pics.filter((p) => p.id !== pd?.id), [pics, pd]);
  const unassigned = useMemo(
    () => members.filter((m) => !m.team_code || !teams.some((t) => t.code === m.team_code)).sort(sortPics),
    [members, teams],
  );

  const totalTO = teams.reduce((s, t) => s + (t.target_headcount ?? 0), 0);
  const totalMembers = members.length + (pd ? 1 : 0);

  const saveTarget = async (team: Team, value: number) => {
    const { error } = await (supabase as any)
      .from("team_master").update({ target_headcount: value }).eq("id", team.id);
    if (error) { toast.error(`정원 저장 실패: ${error.message}`); return; }
    await qc.invalidateQueries({ queryKey: ["org-chart", "teams"] });
  };

  const loading = picsQ.isLoading || teamsQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Organization Chart</h2>
          <p className="text-sm text-muted-foreground">HDEC PIC 기준 프로젝트 조직도</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
            <Users className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-medium">
              {totalMembers}<span className="text-muted-foreground">/{totalTO}</span>
            </span>
            <span className="text-xs text-muted-foreground">현원/TO</span>
          </div>
          {totalTO - totalMembers > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-card px-3 py-1.5">
              <span className="font-mono text-sm font-medium text-warning">-{totalTO - totalMembers}</span>
              <span className="text-xs text-muted-foreground">부족</span>
            </div>
          )}
        </div>
      </div>

      {canManage && teams.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">팀 정원(TO)</span>
          {teams.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t.name}</span>
              <Input
                type="number"
                defaultValue={t.target_headcount ?? 0}
                onBlur={(e) => {
                  const v = Number(e.target.value) || 0;
                  if (v !== (t.target_headcount ?? 0)) void saveTarget(t, v);
                }}
                className="h-7 w-16 text-xs"
              />
            </label>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center"><Skeleton className="h-64 w-96" /></div>
      ) : (
        <div className="overflow-x-auto pb-8">
          <div className="flex min-w-fit flex-col items-center">
            <OrgNode
              label="Project Director"
              name={pd?.name ?? "TBD"}
              sublabel={pd?.rank_title ?? undefined}
              variant="pd"
              onEdit={canManage && pd ? () => setEditPic(pd) : undefined}
            />

            {teams.length > 0 && (
              <>
                <VerticalLine />
                <HorizontalBranch count={teams.length} />
                <div className="flex items-start gap-0">
                  {teams.map((team) => {
                    const teamMembers = members.filter((m) => m.team_code === team.code);
                    const ids = new Set(teamMembers.map((m) => m.id));
                    const roots = teamMembers
                      .filter((m) => !m.parent_pic_id || !ids.has(m.parent_pic_id))
                      .sort(sortPics);
                    return (
                      <div key={team.id} className="flex min-w-[200px] flex-col items-center px-4">
                        <VerticalLine />
                        <OrgNode
                          label={team.name}
                          sublabel={team.code}
                          count={`${teamMembers.length}/${team.target_headcount ?? 0}`}
                          variant="team"
                          warning={teamMembers.length < (team.target_headcount ?? 0)}
                        />
                        {roots.length > 0 && (
                          <>
                            <VerticalLine short />
                            <div className="w-full space-y-1 py-1">
                              {roots.map((r) => (
                                <MemberBranch
                                  key={r.id}
                                  pic={r}
                                  pool={teamMembers}
                                  depth={0}
                                  onEdit={canManage ? setEditPic : undefined}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!loading && unassigned.length > 0 && (
        <div className="mt-4 border-t border-border pt-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
            <User className="h-5 w-5 text-muted-foreground" />
            미배정 인원
            <Badge variant="secondary" className="font-mono text-xs">{unassigned.length}</Badge>
          </h3>
          <div className="flex flex-wrap gap-3">
            {unassigned.map((m) => (
              <MemberCard key={m.id} pic={m} onEdit={canManage ? setEditPic : undefined} />
            ))}
          </div>
        </div>
      )}

      <OrgPicEditDialog
        pic={editPic}
        all={pics}
        teams={teams}
        open={!!editPic}
        onOpenChange={(v) => { if (!v) setEditPic(null); }}
      />
    </div>
  );
}

/* ─── 트리 커넥터 ─── */

function VerticalLine({ short }: { short?: boolean }) {
  return <div className="w-px bg-border" style={{ height: short ? 12 : 20 }} />;
}

function HorizontalBranch({ count }: { count: number }) {
  if (count <= 1) return null;
  return <div className="h-px bg-border" style={{ width: `calc(${count - 1} * 200px)` }} />;
}

/* ─── 노드 ─── */

function OrgNode({ label, name, sublabel, count, variant, warning, onEdit }: {
  label: string;
  name?: string;
  sublabel?: string;
  count?: string;
  variant: "pd" | "team";
  warning?: boolean;
  onEdit?: () => void;
}) {
  const base = "rounded-lg border text-center transition-colors relative";
  if (variant === "pd") {
    return (
      <div className={`${base} min-w-[220px] border-primary/40 bg-primary/10 px-6 py-3`}>
        <div className="mb-1 flex items-center justify-center gap-2">
          <Crown className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">{label}</span>
        </div>
        <p className="text-base font-bold">{name}</p>
        {sublabel && <span className="mt-1 block text-xs text-muted-foreground">{sublabel}</span>}
        {onEdit && (
          <Button variant="ghost" size="sm" className="absolute right-1 top-1 h-6 w-6 p-0" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={`${base} min-w-[170px] border-border bg-card px-4 py-2.5 shadow-sm`}>
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-1 flex items-center justify-center gap-2">
        {sublabel && <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">{sublabel}</Badge>}
        {count && (
          <span className={`font-mono text-xs ${warning ? "text-warning" : "text-muted-foreground"}`}>{count}</span>
        )}
      </div>
    </div>
  );
}

function MemberBranch({ pic, pool, depth, onEdit }: {
  pic: OrgPic;
  pool: OrgPic[];
  depth: number;
  onEdit?: (p: OrgPic) => void;
}) {
  const children = pool.filter((p) => p.parent_pic_id === pic.id).sort(sortPics);
  return (
    <div className="w-full" style={{ paddingLeft: depth > 0 ? 10 : 0 }}>
      <MemberCard pic={pic} onEdit={onEdit} />
      {children.length > 0 && (
        <div className="mt-1 space-y-1 border-l border-border pl-2">
          {children.map((c) => (
            <MemberBranch key={c.id} pic={c} pool={pool} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({ pic, onEdit }: { pic: OrgPic; onEdit?: (p: OrgPic) => void }) {
  const sub = [pic.duty_title, pic.rank_title].filter(Boolean).join(" · ");
  return (
    <div className="flex w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
        <User className="h-2.5 w-2.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium leading-tight">{pic.name}</p>
        {sub && <p className="truncate text-[9px] leading-tight text-muted-foreground">{sub}</p>}
      </div>
      {onEdit && (
        <Button variant="ghost" size="sm" className="ml-auto h-5 w-5 shrink-0 p-0" onClick={() => onEdit(pic)}>
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}