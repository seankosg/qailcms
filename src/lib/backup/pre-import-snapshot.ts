import { createPreImportSnapshot } from "./backup.functions";

export type PreImportModule = "abd" | "sm" | "tm" | "spare-part";

export async function takePreImportSnapshot(
  module: PreImportModule,
  importLogId?: string,
) {
  return await createPreImportSnapshot({ data: { module, import_log_id: importLogId } });
}
