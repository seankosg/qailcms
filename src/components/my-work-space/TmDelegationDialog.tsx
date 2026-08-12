/**
 * TM 부재중 업무 인수인계(위임) 등록/해제 다이얼로그.
 *
 * 원본 담당자(hdec_pic_name)는 절대 바꾸지 않는다. tm_pic_delegations 에
 * 기간 위임만 기록하고, 조회 시점(as_of)에 유효 담당자가 자동으로 결정된다.
 * 기간이 끝나면 별도 조치 없이 원 담당자로 되돌아온다.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { UserCog, Check, ChevronsUpDown, AlertTriangle, FileDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { todayInDoha } from "@/lib/time/doha";
import { exportDelegationsToExcel } from "@/lib/organization/export-delegations";

interface Props {
  myPic: string | null;
  userId: string | null;
}

interface TaskRow { id: string; task_no: string | null; task_name: string | null; }
interface DelegationRow {
  id: string; task_raw_id: string; from_pic: string; to_pic: string;
  start_date: string; end_date: string; status: string;
  note?: string | null;
  task?: { task_no: string | null; task_name: string | null } | null;
}

function todayIso(): string {
  try { return todayInDoha(); } catch { return new Date().toISOString().slice(0, 10); }
}

export function TmDelegationDialog({ myPic, userId }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toPic, setToPic] = useState("");
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [picOpen, setPicOpen] = useState(false);
  const [picQuery, setPicQuery] = useState("");

  const myTasksQ = useQuery<TaskRow[]>({
    queryKey: ["tm-deleg", "my-tasks", myPic],
    enabled: open && !!myPic,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("id,task_no,task_name")
        .eq("hdec_pic_name", myPic)
        .order("task_no", { ascending: true })
        .limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskRow[];
    },
  });

  const picsQ = useQuery<string[]>({
    queryKey: ["tm-deleg", "pic-master"],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hdec_pic_name_master")
        .select("name,is_active")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(2000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ name: string }>).map((r) => r.name).filter(Boolean);
    },
  });

  const listQ = useQuery<DelegationRow[]>({
    queryKey: ["tm-deleg", "list", myPic],
    enabled: open && !!myPic,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tm_pic_delegations")
        .select("id,task_raw_id,from_pic,to_pic,start_date,end_date,status,note,task:task_management_raw(task_no,task_name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as DelegationRow[];
    },
  });

  const tasks = useMemo(() => {
    const all = myTasksQ.data ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 300);
    return all
      .filter((t) => `${t.task_no ?? ""} ${t.task_name ?? ""}`.toLowerCase().includes(s))
      .slice(0, 300);
  }, [myTasksQ.data, q]);

  // 본인 제외 + 검색
  const picOptions = useMemo(() => {
    const all = (picsQ.data ?? []).filter((n) => n && n !== myPic);
    const s = picQuery.trim().toLowerCase();
    const list = s ? all.filter((n) => n.toLowerCase().includes(s)) : all;
    return list.slice(0, 300);
  }, [picsQ.data, picQuery, myPic]);

  // 선택한 이름이 실제 계정으로 해석되는지 확인 (이름만 있고 계정 없는 사람 차단)
  const resolveQ = useQuery<string | null>({
    queryKey: ["tm-deleg", "resolve-user", toPic],
    enabled: open && !!toPic,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("resolve_user_by_name", { _name: toPic });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
  });
  const resolvedUserId = resolveQ.data ?? null;
  const resolveChecking = !!toPic && resolveQ.isFetching;
  const resolveFailed = !!toPic && !resolveQ.isFetching && !resolveQ.isError && !resolvedUserId;

  const toggle = (id: string) => {
    setPicked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const submit = async () => {
    if (!myPic) { toast.error("내 HDEC PIC 이름이 없어 위임할 수 없습니다."); return; }
    if (picked.size === 0) { toast.error("위임할 업무를 선택하세요."); return; }
    if (!toPic) { toast.error("인수자를 선택하세요."); return; }
    if (!resolvedUserId) {
      toast.error(`"${toPic}" 은(는) 연결된 계정이 없어 위임할 수 없습니다.`);
      return;
    }
    if (end < start) { toast.error("종료일이 시작일보다 빠릅니다."); return; }
    setSaving(true);
    try {
      const rows = Array.from(picked).map((id) => ({
        task_raw_id: id,
        from_pic: myPic,
        to_pic: toPic.trim(),
        start_date: start,
        end_date: end,
        status: "active",
        note: note.trim() || null,
        created_by: userId,
      }));
      const { error } = await (supabase as any).from("tm_pic_delegations").insert(rows);
      if (error) throw new Error(error.message);
      toast.success(`위임 ${rows.length}건 등록 — ${start} ~ ${end} → ${toPic.trim()}`);
      setPicked(new Set());
      setNote("");
      await qc.invalidateQueries({ queryKey: ["tm-deleg"] });
      await qc.invalidateQueries({ queryKey: ["my-workspace"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 해제 규칙 — 시작 여부로 갈린다.
   *  start_date >  오늘: 아직 시작 안 함 → status='cancelled'
   *  start_date <= 오늘: 이미 진행 → end_date=오늘 으로 단축(status 는 active 유지)
   *  end_date   <  오늘: 이미 끝남 → 해제 대상 아님
   * 과거를 소급해 바꾸지 않는다. start_date 는 어느 경우에도 바꾸지 않는다.
   */
  const cancelOne = async (d: DelegationRow) => {
    const today = todayIso();
    if (d.end_date < today) return; // 종료된 위임은 손대지 않는다
    const started = d.start_date <= today;
    if (started) {
      const ok = window.confirm(
        "오늘까지는 인수자에게 남고 내일부터 원 담당자로 돌아옵니다. 종료하시겠습니까?",
      );
      if (!ok) return;
    }
    const patch = started ? { end_date: today } : { status: "cancelled" };
    const { error } = await (supabase as any)
      .from("tm_pic_delegations")
      .update(patch)
      .eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    toast.success(started ? `위임을 오늘(${today})까지로 종료했습니다.` : "시작 전 위임을 취소했습니다.");
    await qc.invalidateQueries({ queryKey: ["tm-deleg"] });
    await qc.invalidateQueries({ queryKey: ["my-workspace"] });
  };

  const mine = (listQ.data ?? []).filter((d) => d.from_pic === myPic);
  const received = (listQ.data ?? []).filter((d) => d.to_pic === myPic);

  /** 내가 위임한 건 중 기간이 겹치는 것만 내보낸다. 겹치는 게 없으면 전체. */
  const exportRows = useMemo(() => {
    const inRange = mine.filter((d) => d.start_date <= end && d.end_date >= start);
    const base = inRange.length > 0 ? inRange : mine;
    return base.map((d) => ({
      task_no: d.task?.task_no ?? null,
      task_name: d.task?.task_name ?? null,
      from_pic: d.from_pic,
      to_pic: d.to_pic,
      start_date: d.start_date,
      end_date: d.end_date,
      status: d.status,
      note: d.note ?? null,
    }));
  }, [mine, start, end]);

  const doExport = async () => {
    if (exportRows.length === 0) { toast.error("내보낼 인수인계 내역이 없습니다."); return; }
    const s = exportRows.reduce((a, r) => (r.start_date < a ? r.start_date : a), exportRows[0].start_date);
    const e = exportRows.reduce((a, r) => (r.end_date > a ? r.end_date : a), exportRows[0].end_date);
    try {
      await exportDelegationsToExcel({
        userName: myPic ?? "미상",
        startDate: s,
        endDate: e,
        rows: exportRows,
      });
      toast.success(`엑셀 ${exportRows.length}건 내보냈습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserCog className="h-4 w-4" />
          업무 인수인계
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">TM 부재중 업무 인수인계 (위임)</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">위임할 내 업무 선택 ({picked.size}건 선택)</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Task No / 이름 검색"
              className="h-8 text-xs"
            />
            <ScrollArea className="h-64 rounded border">
              <div className="p-2 space-y-1">
                {myTasksQ.isLoading && <div className="text-xs text-muted-foreground">불러오는 중…</div>}
                {!myTasksQ.isLoading && tasks.length === 0 && (
                  <div className="text-xs text-muted-foreground">표시할 업무가 없습니다.</div>
                )}
                {tasks.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-accent/40 rounded px-1 py-0.5">
                    <Checkbox checked={picked.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                    <span className="font-mono">{t.task_no ?? "-"}</span>
                    <span className="truncate text-muted-foreground">{t.task_name ?? ""}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">인수자 (HDEC PIC)</Label>
              <Popover open={picOpen} onOpenChange={(v) => { setPicOpen(v); if (v) setPicQuery(""); }}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={picOpen}
                    className="h-8 w-full justify-between text-xs font-normal"
                  >
                    <span className={toPic ? "" : "text-muted-foreground"}>
                      {toPic || "명부에서 선택"}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-2" align="start">
                  <Input
                    value={picQuery}
                    onChange={(e) => setPicQuery(e.target.value)}
                    placeholder="이름 검색"
                    className="h-8 text-xs mb-2"
                    autoFocus
                  />
                  <ScrollArea className="h-56">
                    <div className="space-y-0.5 pr-2">
                      {picsQ.isLoading && <div className="text-xs text-muted-foreground px-1 py-2">불러오는 중…</div>}
                      {!picsQ.isLoading && picOptions.length === 0 && (
                        <div className="text-xs text-muted-foreground px-1 py-2">일치하는 이름이 없습니다.</div>
                      )}
                      {picOptions.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                          onClick={() => { setToPic(n); setPicOpen(false); }}
                        >
                          <Check className={`h-3.5 w-3.5 ${toPic === n ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{n}</span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
              {resolveChecking && (
                <p className="text-[11px] text-muted-foreground">계정 확인 중…</p>
              )}
              {resolveFailed && (
                <p className="flex items-start gap-1 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  "{toPic}" 은(는) 명부에는 있으나 연결된 계정이 없습니다. 계정이 생성되어야 위임이 실제로 적용됩니다.
                </p>
              )}
              {!!toPic && !!resolvedUserId && (
                <p className="text-[11px] text-muted-foreground">계정 확인됨</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">시작일</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">종료일</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">사유 (선택)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 연차" className="h-8 text-xs" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              원 담당자 기록은 그대로 남고, 기간이 끝나면 자동으로 원 담당자에게 돌아옵니다.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">현재 위임 현황</Label>
          <ScrollArea className="h-40 rounded border">
            <div className="p-2 space-y-1 text-xs">
              {mine.length === 0 && received.length === 0 && (
                <div className="text-muted-foreground">등록된 위임이 없습니다.</div>
              )}
              {mine.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">내가 위임</Badge>
                  <span className="font-mono">{d.task?.task_no ?? d.task_raw_id.slice(0, 8)}</span>
                  <span>→ {d.to_pic}</span>
                  <span className="text-muted-foreground">{d.start_date} ~ {d.end_date}</span>
                  <Badge variant={d.status === "active" ? "secondary" : "outline"} className="text-[10px]">{d.status}</Badge>
                  {d.status === "active" &&
                    (d.start_date > todayIso() || d.end_date > todayIso()) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => cancelOne(d)}
                    >
                      {d.start_date > todayIso() ? "취소" : "종료"}
                    </Button>
                  )}
                </div>
              ))}
              {received.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-info text-info">인수받음</Badge>
                  <span className="font-mono">{d.task?.task_no ?? d.task_raw_id.slice(0, 8)}</span>
                  <span>← {d.from_pic}</span>
                  <span className="text-muted-foreground">{d.start_date} ~ {d.end_date}</span>
                  <Badge variant={d.status === "active" ? "secondary" : "outline"} className="text-[10px]">{d.status}</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={doExport}
            disabled={exportRows.length === 0}
          >
            <FileDown className="h-4 w-4" />
            엑셀 내보내기
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={saving || !toPic || !resolvedUserId || resolveChecking || picked.size === 0}
          >
            {saving ? "등록 중…" : "위임 등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
