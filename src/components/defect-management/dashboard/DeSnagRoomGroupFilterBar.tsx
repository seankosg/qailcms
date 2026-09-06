import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  ROOM_GROUP_ORDER,
  type RoomGroupCol,
} from "@/lib/defect-management/dashboard-shape";
import { X } from "lucide-react";

export function DeSnagRoomGroupFilterBar({
  selected,
  onChange,
  available,
}: {
  selected: RoomGroupCol[];
  onChange: (next: RoomGroupCol[]) => void;
  /** 데이터에 존재하는 room group 목록. 없으면 전체 노출. */
  available?: readonly string[];
}) {
  const has = (rg: string) =>
    !available || available.includes(rg) || selected.includes(rg as RoomGroupCol);
  // 표준 순서 우선, 데이터에만 존재하는 값은 뒤에 이름 순
  const groups = [
    ...ROOM_GROUP_ORDER.filter((rg) => has(rg)),
    ...(available ?? [])
      .filter((rg) => !(ROOM_GROUP_ORDER as readonly string[]).includes(rg))
      .sort((a, b) => a.localeCompare(b)),
  ];
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Room Group</span>
      <ToggleGroup
        type="multiple"
        value={selected as string[]}
        onValueChange={(v) => onChange(v as RoomGroupCol[])}
        className="flex-wrap gap-1"
      >
        {groups.map((rg) => (
          <ToggleGroupItem
            key={rg}
            value={rg}
            className="h-7 px-2 text-[11px] font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {rg}
          </ToggleGroupItem>
        ))}
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
