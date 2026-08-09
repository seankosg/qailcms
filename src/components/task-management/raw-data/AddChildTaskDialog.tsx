import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  ROW_TYPES,
  STATUS_MANUAL,
  RISK_LEVELS,
  type Discipline,
} from "@/lib/task-management/columns";
import { WorkTypeCombo } from "./WorkTypeCombo";
import { addChildTask } from "@/lib/task-management/hierarchy.functions";
import { useRclCan } from "@/hooks/useRclCan";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export interface ParentSeed {
  task_no: string;
  discipline: Discipline;
  task_name?: string | null;
  category?: string | null;
  hdec_pic_name?: string | null;
  hdec_eng_name?: string | null;
  floor_level?: string | null;
  location?: string | null;
  risk?: string | null;
  plan_start?: string | null;
  plan_end?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parent: ParentSeed | null;
  onCreated?: () => void;
}

export function AddChildTaskDialog({ open, onOpenChange, parent, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [subTaskDesc, setSubTaskDesc] = useState("");
  const [category, setCategory] = useState("");
  const [hdecPic, setHdecPic] = useState("");
  const [hdecEng, setHdecEng] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
  const [location, setLocation] = useState("");
  const [rowType, setRowType] = useState<string>("");
  const [statusManual, setStatusManual] = useState<string>("예정");
  const [risk, setRisk] = useState<string>("");
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");

  const submit = useServerFn(addChildTask);
  // ⛔ 임시 조치: Work Type 신규 값 생성은 admin 만 가능(비관리자는 기존 값 선택만).
  const { data: me } = useCurrentUser();
  const isAdminEditor = !!me?.isAdmin;
  // 담당자 지정 범위 — 서버 `rcl_can_values` 와 동일 근거(`rcl_grants`).
  const { grants } = useRclCan("TM", "write");
  const ownerLocked = !!grants && !grants.other_team && !grants.own_team;
  const myName = grants?.my_name ?? "";

  useEffect(() => {
    if (!open || !parent) return;
    setTaskName(parent.task_name ?? "");
    setSubTaskDesc("");
    setCategory(parent.category ?? "");
    setHdecPic(ownerLocked ? myName : (parent.hdec_pic_name ?? ""));
    setHdecEng(ownerLocked ? "" : (parent.hdec_eng_name ?? ""));
    setFloorLevel(parent.floor_level ?? "");
    setLocation(parent.location ?? "");
    setRowType("");
    setStatusManual("예정");
    setRisk(parent.risk ?? "");
    setPlanStart(parent.plan_start ?? "");
    setPlanEnd(parent.plan_end ?? "");
  }, [open, parent, ownerLocked, myName]);

  async function handleSave() {
    if (!parent) return;
    if (!taskName.trim()) {
      toast.error("Task 이름을 입력하세요");
      return;
    }
    setSaving(true);
    try {
      const res = await submit({
        data: {
          discipline: parent.discipline,
          main_task_no: parent.task_no,
          task_name: taskName.trim(),
          sub_task_desc: subTaskDesc.trim() || null,
          category: category.trim() || null,
          hdec_pic_name: hdecPic.trim() || null,
          hdec_eng_name: hdecEng.trim() || null,
          floor_level: floorLevel.trim() || null,
          location: location.trim() || null,
          row_type: rowType || null,
          status_manual: statusManual || null,
          risk: risk || null,
          plan_start: planStart || null,
          plan_end: planEnd || null,
        },
      });
      toast.success(`하위 태스크 추가 완료: ${res.task_no}`);
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            Sub Task 추가{" "}
            <span className="text-xs font-normal text-muted-foreground">
              → {parent?.task_no}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Task 이름 *</Label>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Main Task와 동일 or 새 이름"
              className="mt-1"
              maxLength={500}
            />
          </div>
          <div>
            <Label className="text-xs">Sub-Task 설명</Label>
            <Textarea
              value={subTaskDesc}
              onChange={(e) => setSubTaskDesc(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">HDEC PIC (한글)</Label>
              <Input
                value={hdecPic}
                onChange={(e) => setHdecPic(e.target.value)}
                className="mt-1"
                readOnly={ownerLocked}
              />
            </div>
            <div>
              <Label className="text-xs">HDEC ENG (영문)</Label>
              <Input
                value={hdecEng}
                onChange={(e) => setHdecEng(e.target.value)}
                className="mt-1"
                readOnly={ownerLocked}
              />
            </div>
            <div>
              <Label className="text-xs">Level (층)</Label>
              <Input value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Work Type</Label>
              <div className="mt-1">
                <WorkTypeCombo value={rowType} onChange={setRowType} allowNew={isAdminEditor} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusManual} onValueChange={setStatusManual}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_MANUAL.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Risk</Label>
              <Select value={risk || "__none__"} onValueChange={(v) => setRisk(v === "__none__" ? "" : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(비우기)</SelectItem>
                  {RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div />
            <div>
              <Label className="text-xs">P.Start</Label>
              <Input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">P.Finish</Label>
              <Input type="date" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} className="mt-1 font-mono text-xs" />
            </div>
          </div>
        </div>

        {ownerLocked && (
          <p className="text-[11px] text-muted-foreground">
            현재 권한 범위(본인 담당)에서는 담당자를 본인({myName || "—"})으로만 지정할 수 있습니다.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}