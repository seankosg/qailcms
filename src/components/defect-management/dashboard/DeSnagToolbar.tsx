import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ALL_TEAMS, type TeamKey } from "@/lib/defect-management/dashboard-shape";

export function DeSnagToolbar({
  teams,
  onChange,
}: {
  teams: TeamKey[];
  onChange: (t: TeamKey[]) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Team</span>
      <ToggleGroup
        type="multiple"
        value={teams}
        onValueChange={(v) => onChange((v as TeamKey[]).filter((x) => (ALL_TEAMS as readonly string[]).includes(x)))}
        className="gap-1"
      >
        {ALL_TEAMS.map((t) => (
          <ToggleGroupItem
            key={t}
            value={t}
            className="h-7 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {t}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {teams.length === 0 && (
        <span className="text-[11px] text-muted-foreground">(전체)</span>
      )}
    </div>
  );
}
