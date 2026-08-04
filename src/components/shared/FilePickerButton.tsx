import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  disabled?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList) => void;
};

/** 공용 파일 선택 버튼 — 미선택 primary, 선택 완료 시 초록 + 체크 + 파일명/개수 표기 */
export function FilePickerButton({
  label,
  accept,
  multiple,
  directory,
  disabled,
  className,
  inputRef,
  onFiles,
}: Props) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  const id = useId();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <input
        ref={ref}
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        {...(directory ? ({ webkitdirectory: "" } as Record<string, string>) : {})}
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          setPicked(files.length > 1 ? `${files.length}개 파일 선택됨` : (files[0]?.name ?? null));
          onFiles(files);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant={picked ? "outline" : "default"}
        disabled={disabled}
        className={cn(
          picked &&
            "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
        )}
        onClick={() => ref.current?.click()}
      >
        {picked ? <Check className="mr-1.5 h-4 w-4" /> : <Upload className="mr-1.5 h-4 w-4" />}
        {picked ? "선택 완료" : label}
      </Button>
      {picked && (
        <span className="max-w-[320px] truncate text-xs text-muted-foreground" title={picked}>
          {picked}
        </span>
      )}
    </div>
  );
}
