import { useMemo } from "react";
import {
  ColumnSelectDialog,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";
import { useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";
import { isKnownDefectField } from "@/lib/defect-management/parser";

interface DefectColumnSelectProps {
  fileName: string;
  headers: string[];
  samples: Record<string, unknown>;
  headerToFieldMap: Record<string, string>;
  defaultExcluded: string[];
  isReimport: boolean;
  open: boolean;
  onClose: () => void;
  onApply: (excluded: string[]) => void;
}

/** 프리셋별 유지할 canonical field 집합 (SHAW와 등가). */
const ACONEX_FIELDS = new Set([
  "source_issue_no",
  "status_raw",
  "updated_status",
  "updated_date_raw",
  "priority",
  "classification",
  "category",
]);
const HDEC_FIELDS = new Set([
  "source_issue_no",
  "subcontractor_name",
  "subsub_name",
  "hdec_pic_name",
  "hdec_eng_name",
  "planned_start_date",
  "planned_completion_date",
  "planned_closure_date",
  "actual_start_date",
  "actual_completion_date",
  "actual_closure_date",
]);
const CAT_CHECK_FIELDS = new Set([
  "source_issue_no",
  "description",
  "priority",
  "hdec_verification",
  "hdec_reason",
  "closure_status",
  "actual_closure_date",
  "status_raw",
]);

export function DefectColumnSelect({
  fileName,
  headers,
  samples,
  headerToFieldMap,
  defaultExcluded,
  isReimport,
  open,
  onClose,
  onApply,
}: DefectColumnSelectProps) {
  const { isFieldRequired, getLabel, getSourceLabel, getSourceOrigin } =
    useDefectFieldHelpers();

  const helpers = useMemo<ColumnSelectHelpers>(() => {
    const toField = (h: string) => headerToFieldMap[h] ?? "";
    return {
      toFieldName: toField,
      getRequirement: (header: string) => {
        const field = toField(header);
        if (field === "source_issue_no") {
          return {
            required: true,
            reason: "system",
            message: `⚠ "${header}"는 ID(source_issue_no)에 매핑되며 파일 인식에 필수입니다. 제외 시 임포트가 실패합니다.`,
          };
        }
        if (isReimport && field === "source_issue_no") {
          return {
            required: true,
            reason: "reimport",
            message: `⚠ Re-import 파일에서 "${header}"를 제외하면 기존 행 업데이트가 아닌 신규 행 생성이 시도됩니다.`,
          };
        }
        if (isFieldRequired(field)) {
          return {
            required: true,
            reason: "config",
            message: `⚠ "${getLabel(field)}"는 Field Config에서 필수로 지정되어 있습니다. 제외 시 필수 필드가 비게 됩니다.`,
          };
        }
        return { required: false };
      },
      getSourceLabel,
      getSourceOrigin,
      isKnownField: (field) => isKnownDefectField(field) || isFieldRequired(field),
      extraWarnings: (excluded) => {
        const lines: string[] = [];
        const locationExcluded = Array.from(excluded).some(
          (h) => headerToFieldMap[h] === "location_raw",
        );
        if (locationExcluded) {
          lines.push(
            'Location 헤더를 제외하면 이번 임포트에서는 Area Type/Level/Location 파생 필드도 갱신되지 않습니다.',
          );
        }
        return lines;
      },
    };
  }, [
    headerToFieldMap,
    isReimport,
    isFieldRequired,
    getLabel,
    getSourceLabel,
    getSourceOrigin,
  ]);

  const presets = useMemo(() => {
    const aconexHeaders = headers.filter((h) => ACONEX_FIELDS.has(headerToFieldMap[h]));
    const hdecHeaders = headers.filter((h) => HDEC_FIELDS.has(headerToFieldMap[h]));
    const catCheckHeaders = headers.filter((h) => CAT_CHECK_FIELDS.has(headerToFieldMap[h]));

    return [
      { id: "new-upload", label: "New Upload", matchedHeaders: undefined },
      {
        id: "update-aconex",
        label: "Update from Aconex",
        matchedHeaders: aconexHeaders,
        className:
          "border-emerald-300 text-emerald-900 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-950",
      },
      {
        id: "update-hdec",
        label: "HDEC's Update",
        matchedHeaders: hdecHeaders,
        className:
          "border-blue-300 text-blue-900 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-950",
      },
      {
        id: "cat-check",
        label: "Cat Check",
        matchedHeaders: catCheckHeaders,
        className:
          "border-rose-300 text-rose-900 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-950",
      },
    ];
  }, [headers, headerToFieldMap]);

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