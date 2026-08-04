import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  rows: Record<string, unknown>[];
  /** 표시용 식별자 후보 컬럼(앞에서부터 값이 있는 것 사용). */
  labelKeys: string[];
}

/** 권한 밖으로 제외된 행을 숫자만이 아니라 목록으로 펼쳐 보여준다(임포트 outOfScope 와 동일 기준). */
export function OutOfScopeRowsPopover({ rows, labelKeys }: Props) {
  if (rows.length === 0) return null;
  const label = (r: Record<string, unknown>) => {
    for (const k of labelKeys) {
      const v = r[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return String(r.id ?? "(id 없음)");
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 underline underline-offset-2 text-amber-600 hover:text-amber-700 dark:text-amber-400"
        >
          · 권한 밖 제외 {rows.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
          권한 밖 미반영 {rows.length}건
        </div>
        <ul className="max-h-56 space-y-0.5 overflow-auto text-[11px] font-mono">
          {rows.slice(0, 200).map((r, i) => (
            <li key={String(r.id ?? i)} className="truncate">{label(r)}</li>
          ))}
        </ul>
        {rows.length > 200 && (
          <div className="mt-1 text-[11px] text-muted-foreground">… 외 {rows.length - 200}건</div>
        )}
      </PopoverContent>
    </Popover>
  );
}