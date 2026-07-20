import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BACKUP_TABLES, MODULE_PRE_IMPORT_TABLES, type BackupTableName, type PreImportModule } from "./backup-shared";

async function assertAdminOrSuper(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["admin", "superuser"],
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자 또는 Super User 권한이 필요합니다.");
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin 권한이 필요합니다.");
}

export const listSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("database_snapshots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getBackupLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [backup, restore] = await Promise.all([
      context.supabase
        .from("backup_run_log")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20),
      context.supabase
        .from("restore_run_log")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);
    if (backup.error) throw new Error(backup.error.message);
    if (restore.error) throw new Error(restore.error.message);
    return { backup: backup.data ?? [], restore: restore.data ?? [] };
  });

export const getBackupConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("backup_config")
      .select("*")
      .order("id", { ascending: true })
      .limit(1)
      .single();
    if (error) {
      // create default if not exists
      const { data: created, error: createError } = await context.supabase
        .from("backup_config")
        .insert({})
        .select()
        .single();
      if (createError) throw new Error(createError.message);
      return created;
    }
    return data;
  });

export const updateBackupConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    retention_days?: number;
    keep_minimum_count?: number;
    schedule_cron?: string;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const payload: any = {};
    if (data.retention_days !== undefined) payload.retention_days = data.retention_days;
    if (data.keep_minimum_count !== undefined) payload.keep_minimum_count = data.keep_minimum_count;
    if (data.schedule_cron !== undefined) payload.schedule_cron = data.schedule_cron;
    if (Object.keys(payload).length === 0) {
      const { data: current, error } = await context.supabase
        .from("backup_config")
        .select("*")
        .order("id", { ascending: true })
        .limit(1)
        .single();
      if (error) throw new Error(error.message);
      return current;
    }

    const { data: current, error: findError } = await context.supabase
      .from("backup_config")
      .select("id")
      .order("id", { ascending: true })
      .limit(1)
      .single();
    if (findError) throw new Error(findError.message);

    const id = current?.id;
    const { data: updated, error } = await context.supabase
      .from("backup_config")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id!)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const createManualSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name?: string; trigger?: string; metadata?: Record<string, unknown> }) => input)
  .handler(async ({ data, context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const core = await import("./backup-core.server");

    const runId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const name = data.name?.trim() || `manual-${new Date().toISOString()}`;

    const { error: logError } = await supabaseAdmin.from("backup_run_log").insert({
      id: runId,
      status: "running",
      snapshot_id: snapshotId,
    });
    if (logError) throw new Error(logError.message);

    const started = Date.now();
    try {
      const result = await core.createSnapshot(supabaseAdmin, {
        snapshotId,
        name,
        triggeredBy: data.trigger as any || "manual",
        triggerMetadata: data.metadata ?? null,
      });
      await supabaseAdmin
        .from("backup_run_log")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
        })
        .eq("id", runId);
      return result;
    } catch (err) {
      await supabaseAdmin
        .from("backup_run_log")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          error_message: (err as Error).message,
        })
        .eq("id", runId);
      throw err;
    }
  });

export const deleteSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { snapshot_id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const core = await import("./backup-core.server");
    await core.deleteSnapshot(supabaseAdmin, data.snapshot_id);
    return { ok: true };
  });

export const lockSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { snapshot_id: string; is_locked: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("database_snapshots")
      .update({ is_locked: data.is_locked })
      .eq("id", data.snapshot_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    snapshot_id: string;
    tables?: BackupTableName[];
    destructive?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdminOrSuper(context.supabase, context.userId);
    if (data.destructive) {
      await assertAdmin(context.supabase, context.userId);
    }

    const tables = data.tables ?? BACKUP_TABLES;
    const runId = crypto.randomUUID();
    const { error: logError } = await supabaseAdmin.from("restore_run_log").insert({
      id: runId,
      status: "running",
      snapshot_id: data.snapshot_id,
      restored_tables: tables,
      destructive: !!data.destructive,
      initiated_by: context.userId,
    });
    if (logError) throw new Error(logError.message);

    const core = await import("./backup-core.server");
    const started = Date.now();
    try {
      const result = await core.restoreSnapshot(supabaseAdmin, data.snapshot_id, tables, !!data.destructive);
      await supabaseAdmin
        .from("restore_run_log")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          restored_tables: result.restoredTables,
        })
        .eq("id", runId);
      return result;
    } catch (err) {
      await supabaseAdmin
        .from("restore_run_log")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          error_message: (err as Error).message,
        })
        .eq("id", runId);
      throw err;
    }
  });

export const cleanupOldSnapshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const core = await import("./backup-core.server");
    return await core.cleanupOldSnapshots(supabaseAdmin);
  });

export const createPreImportSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { module: PreImportModule; import_log_id?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const core = await import("./backup-core.server");

    const runId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const tables = MODULE_PRE_IMPORT_TABLES[data.module] ?? BACKUP_TABLES;
    const name = `pre-import-${data.module}-${new Date().toISOString()}`;

    const { error: logError } = await supabaseAdmin.from("backup_run_log").insert({
      id: runId,
      status: "running",
      snapshot_id: snapshotId,
    });
    if (logError) throw new Error(logError.message);

    const started = Date.now();
    try {
      const result = await core.createSnapshot(supabaseAdmin, {
        snapshotId,
        name,
        triggeredBy: "pre-import",
        triggerMetadata: { module: data.module, import_log_id: data.import_log_id ?? null },
        tables,
      });
      await supabaseAdmin
        .from("backup_run_log")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
        })
        .eq("id", runId);
      return result;
    } catch (err) {
      await supabaseAdmin
        .from("backup_run_log")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          error_message: (err as Error).message,
        })
        .eq("id", runId);
      throw err;
    }
  });
