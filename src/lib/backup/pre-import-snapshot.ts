import {
  createManualSnapshot,
} from "./backup.functions";

export type PreImportModule = "abd" | "sm" | "tm" | "spare-part";

export async function createPreImportSnapshot(
  module: PreImportModule,
  importLogId?: string,
) {
  try {
    return await createManualSnapshot({
      data: {
        name: `pre-import-${module}-${new Date().toISOString()}`,
        trigger: "pre-import",
        metadata: { module, import_log_id: importLogId ?? null },
      },
    });
  } catch (err) {
    console.error("Pre-import snapshot failed", err);
    throw err;
  }
}
