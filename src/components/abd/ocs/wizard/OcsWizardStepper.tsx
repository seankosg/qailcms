import { AlertTriangle, Check, CircleAlert } from "lucide-react";

export type StepStatus = "pending" | "current" | "done" | "warning" | "blocked";

export type WizardStep = {
  index: number;
  title: string;
  group: "preparation" | "import";
  status: StepStatus;
};

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: "border-muted-foreground/30 bg-muted text-muted-foreground",
  current: "border-primary bg-primary text-primary-foreground",
  done: "border-emerald-600 bg-emerald-600 text-white",
  warning: "border-amber-500 bg-amber-500 text-white",
  blocked: "border-destructive bg-destructive text-destructive-foreground",
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: "대기",
  current: "진행 중",
  done: "완료",
  warning: "경고",
  blocked: "차단",
};

function StatusMark({ status, index }: { status: StepStatus; index: number }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${STATUS_CLASS[status]}`}
      aria-hidden="true"
    >
      {status === "done" ? (
        <Check className="h-4 w-4" />
      ) : status === "warning" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : status === "blocked" ? (
        <CircleAlert className="h-3.5 w-3.5" />
      ) : (
        index
      )}
    </span>
  );
}

export function OcsWizardStepper({
  steps,
  onSelect,
}: {
  steps: WizardStep[];
  onSelect?: (index: number) => void;
}) {
  const groups: { key: "preparation" | "import"; label: string; hint: string }[] = [
    { key: "preparation", label: "Preparation", hint: "로컬 Codex Skill 작업 준비" },
    { key: "import", label: "Import", hint: "QAIL CMS 검증 · 반영" },
  ];

  return (
    <ol className="grid gap-3 md:grid-cols-2" aria-label="ABD OCS 증분 진행 단계">
      {groups.map((g) => (
        <li
          key={g.key}
          className={`rounded-lg border p-3 ${g.key === "preparation" ? "bg-muted/40" : "bg-background"}`}
        >
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-semibold">{g.label}</span>
            <span className="text-[11px] text-muted-foreground">{g.hint}</span>
          </div>
          <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center">
            {steps
              .filter((s) => s.group === g.key)
              .map((s) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => onSelect?.(s.index)}
                  className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-current={s.status === "current" ? "step" : undefined}
                >
                  <StatusMark status={s.status} index={s.index} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{s.title}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {STATUS_LABEL[s.status]}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        </li>
      ))}
    </ol>
  );
}