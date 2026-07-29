import { useMemo, useState } from "react";
import { AlertTriangle, XCircle, CheckCircle2, ArrowRightLeft, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type {
  AbdSourceFileEval,
  AbdSource,
} from "@/lib/abd/source-fingerprint";
import { recordAbdSourceOverride } from "@/lib/abd/source-guard.functions";

type Mode = "hdec" | "aconex";

const MODE_LABEL: Record<Mode, string> = {
  hdec: "HDEC 원본",
  aconex: "Aconex Export",
};
const SOURCE_LABEL: Record<AbdSource, string> = {
  hdec: "HDEC",
  aconex: "Aconex",
  unknown: "불명",
};
const SOURCE_COLOR: Record<AbdSource, string> = {
  hdec: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  aconex: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unknown: "bg-muted text-muted-foreground",
};

interface Props {
  open: boolean;
  mode: Mode;
  evaluations: AbdSourceFileEval[];
  onAcceptMatched: (files: File[]) => void;
  onSwitchMode: (target: Mode, files: File[]) => void;
  onCancel: () => void;
}

export function AbdSourceGuardDialog({
  open,
  mode,
  evaluations,
  onAcceptMatched,
  onSwitchMode,
  onCancel,
}: Props) {
  const { data: me } = useCurrentUser();
  const canOverride = !!(me?.isAdmin || me?.isSuperUser);
  const [forceThrough, setForceThrough] = useState(false);
  const recordOverride = useServerFn(recordAbdSourceOverride);

  const matched = useMemo(
    () => evaluations.filter((e) => e.result.source === mode),
    [evaluations, mode],
  );
  const otherMode: Mode = mode === "hdec" ? "aconex" : "hdec";
  const mismatched = useMemo(
    () =>
      evaluations.filter(
        (e) => e.result.source === otherMode && e.result.confidence === "high",
      ),
    [evaluations, otherMode],
  );
  const unknown = useMemo(
    () =>
      evaluations.filter(
        (e) =>
          e.result.source === "unknown" ||
          (e.result.source === otherMode && e.result.confidence !== "high"),
      ),
    [evaluations, otherMode],
  );

  // 전환 대상: mismatched 파일이 모두 같은 alternate source (otherMode) 로 확정됐을 때만 노출
  const switchable = mismatched.length > 0;

  const handleCancel = () => {
    setForceThrough(false);
    onCancel();
  };

  const handleAcceptMatched = () => {
    onAcceptMatched(matched.map((e) => e.file));
    setForceThrough(false);
  };

  const handleSwitch = () => {
    // 전환 시 mismatched 파일만 대상 모드로 넘김.
    // matched 파일이 있다면 현재 모드에 그대로 유지 (사용자가 이어서 진행하도록).
    onSwitchMode(otherMode, mismatched.map((e) => e.file));
    if (matched.length > 0) onAcceptMatched(matched.map((e) => e.file));
    setForceThrough(false);
  };

  const handleForce = async () => {
    const overrideTargets = [...mismatched, ...unknown];
    if (overrideTargets.length === 0) return;
    try {
      await recordOverride({
        data: {
          mode,
          files: overrideTargets.map((e) => ({
            name: e.file.name,
            detected: e.result.source,
            reasons: e.result.reasons,
          })),
        },
      });
    } catch (err) {
      toast.error(
        `강제 진행 기록 실패: ${(err as Error).message ?? String(err)}`,
      );
      return;
    }
    toast.warning(
      `강제 진행: ${overrideTargets.length}개 파일이 소스 가드를 우회했습니다 (기록됨)`,
    );
    onAcceptMatched(evaluations.map((e) => e.file));
    setForceThrough(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? handleCancel() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ABD 임포트 소스 확인</DialogTitle>
          <DialogDescription>
            현재 모드: <b>{MODE_LABEL[mode]}</b>. 파일 헤더 지문 판정 결과입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {matched.length > 0 && (
            <Section
              title={`일치 (${matched.length})`}
              tone="ok"
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              <FileList items={matched} showReasons={false} />
            </Section>
          )}

          {mismatched.length > 0 && (
            <Section
              title={`소스 불일치 — ${SOURCE_LABEL[otherMode]} 파일 감지 (${mismatched.length})`}
              tone="block"
              icon={<XCircle className="h-4 w-4" />}
            >
              <FileList items={mismatched} showReasons />
              <p className="pt-1 text-xs text-muted-foreground">
                {SOURCE_LABEL[otherMode]} 모드로 전환하고 이 파일들을 옮길 수
                있습니다.
              </p>
            </Section>
          )}

          {unknown.length > 0 && (
            <Section
              title={`판정 실패 (${unknown.length})`}
              tone="warn"
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              <FileList items={unknown} showReasons />
            </Section>
          )}

          {canOverride && (mismatched.length > 0 || unknown.length > 0) && (
            <label className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <Checkbox
                checked={forceThrough}
                onCheckedChange={(v) => setForceThrough(v === true)}
                className="mt-0.5"
              />
              <div>
                <div className="flex items-center gap-1 font-medium text-destructive">
                  <ShieldAlert className="h-4 w-4" /> 강제 진행 (관리자 전용)
                </div>
                <div className="text-xs text-muted-foreground">
                  가드를 우회하고 모든 파일을 <b>{MODE_LABEL[mode]}</b> 파서로
                  넘깁니다. 사고 추적을 위해 abd_import_logs 에 override 항목이
                  기록됩니다.
                </div>
              </div>
            </label>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" onClick={handleCancel}>
            취소
          </Button>
          {matched.length > 0 && !forceThrough && (
            <Button onClick={handleAcceptMatched}>
              일치 파일만 진행 ({matched.length})
            </Button>
          )}
          {switchable && !forceThrough && (
            <Button
              onClick={handleSwitch}
              variant={matched.length === 0 ? "default" : "secondary"}
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              {SOURCE_LABEL[otherMode]} 모드로 전환 ({mismatched.length})
            </Button>
          )}
          {canOverride && forceThrough && (mismatched.length > 0 || unknown.length > 0) && (
            <Button variant="destructive" onClick={handleForce}>
              강제 진행 · 전체 ({evaluations.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  tone,
  icon,
  children,
}: {
  title: string;
  tone: "ok" | "warn" | "block";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div className={`space-y-2 rounded border p-3 ${cls}`}>
      <div className="flex items-center gap-2 font-medium">
        {icon} {title}
      </div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function FileList({
  items,
  showReasons,
}: {
  items: AbdSourceFileEval[];
  showReasons: boolean;
}) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((e, i) => (
        <li key={i} className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{e.file.name}</span>
            <Badge className={SOURCE_COLOR[e.result.source]} variant="secondary">
              감지: {SOURCE_LABEL[e.result.source]}
              {e.result.confidence === "low" ? " (약)" : ""}
            </Badge>
          </div>
          {showReasons && e.result.reasons.length > 0 && (
            <div className="pl-1 text-xs text-muted-foreground">
              근거: {e.result.reasons.slice(0, 4).join(" · ")}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}