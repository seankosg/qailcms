import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  LG_ROOM_GROUPS,
  ROOM_GROUP_ORDER,
  isLgRoomGroup,
  type RoomGroupCol,
} from "@/lib/defect-management/dashboard-shape";
import { X } from "lucide-react";

const LG_TOKEN = "__LG_PODIUM__";

export function DeSnagRoomGroupFilterBar({
  selected,
  onChange,
}: {
  selected: RoomGroupCol[];
  onChange: (next: RoomGroupCol[]) => void;
}) {
  const lgOn = selected.some((s) => isLgRoomGroup(s));
  const toggleValue = [...selected.filter((s) => !isLgRoomGroup(s)), ...(lgOn ? [LG_TOKEN] : [])];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Room Group</span>
      <ToggleGroup
        type="multiple"
        value={toggleValue}
        onValueChange={(v) => {
          const vals = v as string[];
          const base = vals.filter((x): x is RoomGroupCol =>
            (ROOM_GROUP_ORDER as readonly string[]).includes(x),
          );
          const next = vals.includes(LG_TOKEN)
            ? [...base, ...(LG_ROOM_GROUPS as readonly RoomGroupCol[])]
            : base;
          onChange(next);
        }}
        className="flex-wrap gap-1"
      >
        {ROOM_GROUP_ORDER.map((rg) => (
          <ToggleGroupItem
            key={rg}
            value={rg}
            className="h-7 px-2 text-[11px] font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {rg}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem
          value={LG_TOKEN}
          className="h-7 px-2 text-[11px] font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          LG Podium
        </ToggleGroupItem>
      </ToggleGroup>
      {selected.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">(전체)</span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <X className="h-3 w-3" /> 초기화
        </Button>
      )}
    </div>
  );
}