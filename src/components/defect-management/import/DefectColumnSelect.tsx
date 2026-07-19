import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ColumnSelectDialog,
  type ColumnSelectHelpers,
} from "@/components/import/ColumnSelectDialog";
import { useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";
import { isKnownDefectField } from "@/lib/defect-management/parser";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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

interface DbPreset {
  id: string;
  label: string;
  fields: string[];
  sort_order: number;
}

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
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.isAdmin === true;

  const { data: dbPresets = [] } = useQuery({
    queryKey: ["defect-import-presets"],
    queryFn: async (): Promise<DbPreset[]> => {
      const { data, error } = await (supabase as any)
        .from("defect_import_presets")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbPreset[];
    },
    staleTime: 10_000,
  });

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
        // Category/Team 헤더가 전부 제외되면 team이 결정되지 않아 임포트가 전량 실패한다.
        const excludedSet = excluded instanceof Set ? excluded : new Set(excluded);
        const teamCandidateHeaders = headers.filter((h) => {
          const field = headerToFieldMap[h];
          return field === "team" || field === "category";
        });
        const anyTeamHeaderKept =
          teamCandidateHeaders.length === 0
            ? false
            : teamCandidateHeaders.some((h) => !excludedSet.has(h));
        if (teamCandidateHeaders.length > 0 && !anyTeamHeaderKept) {
          lines.push(
            '⚠ Category/Team 헤더가 모두 제외되었습니다. 팀(team) 결정이 불가하여 모든 행이 임포트되지 않고 거부됩니다. 최소 하나는 포함하세요.',
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
    headers,
  ]);

  const presets = useMemo(() => {
    const fromDb = dbPresets.map((p) => {
      const fieldSet = new Set(p.fields);
      const matched = headers.filter((h) => fieldSet.has(headerToFieldMap[h]));
      return {
        id: p.id,
        label: p.label,
        matchedHeaders: matched,
      };
    });
    return [
      { id: "new-upload", label: "New Upload", matchedHeaders: undefined },
      ...fromDb,
    ];
  }, [headers, headerToFieldMap, dbPresets]);

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
      lockRequired={!isAdmin}
    />
  );
}