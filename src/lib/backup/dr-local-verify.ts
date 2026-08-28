/**
 * 로컬 재해복구(DR) 패키지 브라우저 검증 — 순수 로직.
 *
 * 파일 bytes 는 절대 서버로 전송하지 않는다. 이 모듈은 네트워크 호출을 하지 않는다.
 */

/** DR 패키지 포함 업무 버킷 7개 (HP1 확정, tools/dr-package/engine/buckets.mjs 와 동일). */
export const DR_BUCKETS = [
  "abd-ocs-source-files",
  "abd-ocs-attachments",
  "spl-documents",
  "dmr-uploads",
  "spl-ocs-source-files",
  "abd-ocs-imports",
  "spl-ocs-attachments",
] as const;

export const DR_EXCLUDED_BUCKET = "db-backups";

export type DrVerdict = "ok" | "warn" | "fail";

export type DrCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type DrVerifyResult = {
  verdict: DrVerdict;
  checks: DrCheck[];
  summary: {
    runId: string | null;
    createdAt: string | null;
    dumpBytes: number | null;
    dumpSha256: string | null;
    storageFiles: number | null;
    storageBytes: number | null;
    zipBytes: number | null;
    zipSha256: string | null;
    includedBuckets: string[];
    excludedBuckets: string[];
    cleanupWarning: string | null;
  };
};

export type DrZipInput = { name: string; bytes: number; sha256: string };

function baseName(p: string): string {
  return String(p).split(/[\\/]/).pop() ?? "";
}

function runIdFromZipName(name: string): string | null {
  const m = name.match(/^(QAIL_DR_\d{8}_\d{6})\.zip$/i);
  return m ? m[1] : null;
}

/** 영수증(run_receipt.json)과 로컬 ZIP 실측치를 대조한다. */
export function verifyDrPackage(zip: DrZipInput, receipt: any): DrVerifyResult {
  const checks: DrCheck[] = [];
  const add = (id: string, label: string, passed: boolean, detail?: string) =>
    checks.push({ id, label, passed, detail });

  const r = receipt && typeof receipt === "object" ? receipt : {};
  const zipInfo = r.zip && typeof r.zip === "object" ? r.zip : null;
  const receiptZipName = zipInfo ? baseName(zipInfo.path ?? zipInfo.name ?? "") : "";
  const nameRunId = runIdFromZipName(zip.name);

  add("zip-name", "ZIP 파일명이 영수증과 일치", !!receiptZipName && receiptZipName === zip.name,
    `영수증: ${receiptZipName || "없음"} / 선택: ${zip.name}`);
  add("zip-bytes", "ZIP 크기 일치", !!zipInfo && Number(zipInfo.bytes) === zip.bytes,
    `영수증: ${zipInfo?.bytes ?? "없음"} / 실측: ${zip.bytes}`);
  add("zip-sha", "ZIP SHA-256 일치",
    !!zipInfo && typeof zipInfo.sha256 === "string" && zipInfo.sha256.toLowerCase() === zip.sha256.toLowerCase());
  add("status", "영수증 상태 completed", r.status === "completed", `상태: ${r.status ?? "없음"}`);
  add("run-id", "run ID 일치", !!nameRunId && !!r.run_id && r.run_id === nameRunId,
    `영수증: ${r.run_id ?? "없음"} / 파일명: ${nameRunId ?? "형식 불일치"}`);

  const excluded: string[] = Array.isArray(r.excluded_buckets) ? r.excluded_buckets : [];
  add("excluded", "db-backups 제외 선언", excluded.includes(DR_EXCLUDED_BUCKET));

  const dump = r.database_dump && typeof r.database_dump === "object" ? r.database_dump : null;
  add("dump", "DB dump 정보 존재",
    !!dump && Number(dump.bytes) > 0 && typeof dump.sha256 === "string" && dump.sha256.length === 64);

  const perBucket = r.storage && typeof r.storage.buckets === "object" && r.storage.buckets ? r.storage.buckets : {};
  const includedBuckets = Object.keys(perBucket);
  const missing = DR_BUCKETS.filter((b) => !(b in perBucket));
  add("storage", "업무 버킷 7개 결과 존재", missing.length === 0,
    missing.length ? `누락: ${missing.join(", ")}` : `${includedBuckets.length}개 수집`);

  const cleanup = r.cleanup_warning ?? null;
  const cleanupWarning = cleanup ? (typeof cleanup === "string" ? cleanup : (cleanup.path ?? JSON.stringify(cleanup))) : null;

  const allPassed = checks.every((c) => c.passed);
  return {
    verdict: allPassed ? (cleanupWarning ? "warn" : "ok") : "fail",
    checks,
    summary: {
      runId: r.run_id ?? null,
      createdAt: r.finished_at ?? r.started_at ?? null,
      dumpBytes: dump?.bytes ?? null,
      dumpSha256: dump?.sha256 ?? null,
      storageFiles: r.storage?.files ?? null,
      storageBytes: r.storage?.bytes ?? null,
      zipBytes: zipInfo?.bytes ?? null,
      zipSha256: zipInfo?.sha256 ?? null,
      includedBuckets,
      excludedBuckets: excluded,
      cleanupWarning,
    },
  };
}

/** 브라우저가 스트리밍 SHA-256 을 지원하는지. 미지원 시 대용량 검증을 하지 않는다. */
export function supportsStreamingSha256(scope: any = globalThis): boolean {
  return (
    typeof scope?.crypto?.subtle?.digest === "function" &&
    typeof scope?.ReadableStream === "function" &&
    typeof (scope?.File?.prototype as any)?.stream === "function"
  );
}

export function bytesToHumanDr(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}
