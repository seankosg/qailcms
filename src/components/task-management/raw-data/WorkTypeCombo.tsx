import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTmWorkTypeOptions } from "@/hooks/useTmWorkTypeOptions";

const NONE = "__none__";
const NEW = "__new__";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 비우기 옵션 노출 여부 */
  allowEmpty?: boolean;
  className?: string;
  invalid?: boolean;
}

/** 기존값 풀다운 + 신규값 직접 입력 콤보. */
export function WorkTypeCombo({ value, onChange, allowEmpty = true, className, invalid }: Props) {
  const { data: options = [] } = useTmWorkTypeOptions();
  const [manual, setManual] = useState(false);
  const isKnown = !!value && options.includes(value);
  const showInput = manual || (!!value && !isKnown);

  if (showInput) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="새 Work Type 입력"
          className={className ?? "h-8"}
          data-invalid={invalid}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs"
          onClick={() => {
            setManual(false);
            onChange("");
          }}
        >
          목록
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => {
        if (v === NEW) {
          setManual(true);
          onChange("");
          return;
        }
        onChange(v === NONE ? "" : v);
      }}
    >
      <SelectTrigger className={className ?? "h-8"} data-invalid={invalid}>
        <SelectValue placeholder="선택" />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>(비우기)</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
        <SelectItem value={NEW}>+ 새 값 입력…</SelectItem>
      </SelectContent>
    </Select>
  );
}
