import { useMemo } from "react";
import {
  ColumnSelectDialog,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";
import { isKnownTaskField } from "@/lib/task-management/parser";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";

interface TaskColumnSelectProps {
  fileName: string;
  headers: string[];
  samples: Record<string, unknown>;
  headerToFieldMap: Record<string, string>;
  defaultExcluded: string[];
  open: boolean;
  onClose: () => void;
  onApply: (excluded: string[]) => void;
}

/** "Update" 프리셋에서 유지할 필드 — 진도/일정/판정 계열만 남긴다. */
const UPDATE_FIELDS = new Set([
  "task_no",
  "status_manual",
  "plan_start",
  "plan_end",
  "plan_days",
  "actual_start",
  "actual_progress",
  "plan_progress",
  "progress_variance",
  "forecast_end",
  "slip_days",
  "auto_judgment",
]);

export function TaskColumnSelect({
  fileName,
  headers,
  samples,
  headerToFieldMap,
  defaultExcluded,
  open,
  onClose,
  onApply,
}: TaskColumnSelectProps) {
  const getLabel = useTmColumnLabel();

  const helpers = useMemo<ColumnSelectHelpers>(() => {
    const toField = (h: string) => headerToFieldMap[h] ?? "";
    return {
      toFieldName: toField,
      getRequirement: (header: string) => {
        const field = toField(header);
        if (field === "task_no") {
          return {
            required: true,
            reason: "system",
            message: `⚠ "${header}"는 Task No에 매핑되며 파일 인식에 필수입니다. 제외 시 임포트가 실패합니다.`,
          };
        }
        return { required: false };
      },
      isKnownField: (field) => isKnownTaskField(field),
      extraWarnings: () => [],
    };
  }, [headerToFieldMap]);

  const presets = useMemo(() => {
    const updateHeaders = headers.filter((h) => UPDATE_FIELDS.has(headerToFieldMap[h]));
    return [
      { id: "new-upload", label: "New Upload", matchedHeaders: undefined },
      {
        id: "update",
        label: "Update",
        matchedHeaders: updateHeaders,
        className:
          "border-blue-300 text-blue-900 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-950",
      },
    ];
  }, [headers, headerToFieldMap]);

  // suppress unused warning
  void getLabel;

  return (
    <ColumnSelectDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      fileName={fileName}
      headers={headers}
      samples={samples}
      defaultExcluded={defaultExcluded}
      onApply={onApply}
      helpers={helpers}
      presets={presets}
    />
  );
}