import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { HardDriveDownload, CheckCircle2, XCircle, AlertTriangle, Loader2, Download } from "lucide-react";
import {
  DR_BUCKETS,
  DR_EXCLUDED_BUCKET,
  bytesToHumanDr,
  clearedVerificationState,
  supportsStreamingSha256,
  verifyDrPackage,
  type DrVerifyResult,
} from "@/lib/backup/dr-local-verify";
import { sha256OfBlobStream } from "@/lib/backup/sha256-stream";

const GENERATOR_MANIFEST_URL = "/downloads/QAIL-DR-Local-Generator.manifest.json";

type GeneratorManifest = {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  generator_version: string;
  git_commit_short: string;
  migrations_count: number;
  migrations_contract_sha256: string;
};

/**
 * 로컬 재해복구 패키지 안내·검증 카드 (System Administrator 전용).
 * 선택한 ZIP·영수증 bytes 는 브라우저 밖으로 나가지 않는다 — 검증부에는 fetch/업로드가 없다.
 * (생성기 ZIP 다운로드는 정적 배포 자산 GET 이며 사용자 파일을 전송하지 않는다.)
 */
export function LocalDrPackageCard() {
  const zipRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DrVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [gen, setGen] = useState<GeneratorManifest | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const streamOk = supportsStreamingSha256();

  useEffect(() => {
    let alive = true;
    fetch(GENERATOR_MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m) => alive && setGen(m))
      .catch((e) => alive && setGenError(e?.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, []);

  /** 파일 선택이 바뀌면 이전 검증 결과·오류·진행률·저장 확인을 즉시 초기화한다. */
  const resetVerification = () => {
    const cleared = clearedVerificationState();
    setResult(cleared.result);
    setError(cleared.error);
    setProgress(cleared.progress);
    setSaved(cleared.saved);
  };

  const downloadGenerator = async () => {
    if (!gen) return;
    setDownloading(true);
    setGenError(null);
    try {
      const res = await fetch(gen.url);
      if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = gen.file;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setGenError(e?.message ?? String(e));
    } finally {
      setDownloading(false);
    }
  };

  const runVerify = async () => {
    if (!zipFile || !receiptFile) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setProgress(0);
    try {
      const receipt = JSON.parse(await receiptFile.text());
      const sha = await sha256OfBlobStream(zipFile, (read) => setProgress(read));
      setResult(verifyDrPackage({ name: zipFile.name, bytes: zipFile.size, sha256: sha }, receipt));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const verdict = result?.verdict;


  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
        <HardDriveDownload className="h-4 w-4 text-primary" />
        <CardTitle className="text-sm font-medium">로컬 재해복구 패키지</CardTitle>
        <Badge variant="outline" className="ml-1">System Administrator 전용</Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>하루 1회 로컬 PC에 보관하는 전체 재해복구 파일입니다.</li>
          <li>전체 DB(auth 포함)와 업무 Storage 7개 보관함을 포함합니다.</li>
          <li>기존 <code>db-backups</code> Snapshot 파일은 중복이므로 제외합니다.</li>
          <li>패키지는 암호화하지 않습니다.</li>
          <li>최종 ZIP은 사용자가 선택한 로컬 폴더가 정본입니다. 서버에 보관하지 않습니다.</li>
        </ul>

        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">로컬 생성기 내려받기</div>
          <p className="text-xs text-muted-foreground">
            아래 ZIP 하나만 내려받아 압축을 풀면 됩니다. 별도의 설치·저장소 내려받기·npm install 이 필요 없습니다.
          </p>
          <Button size="sm" onClick={downloadGenerator} disabled={!gen || downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            로컬 생성기 다운로드
          </Button>
          {genError ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              생성기 정보를 불러오지 못했습니다 — {genError}
            </div>
          ) : null}
          {gen ? (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <Row k="파일" v={`${gen.file} (${bytesToHumanDr(gen.bytes)})`} />
              <Row k="생성기 버전" v={gen.generator_version} />
              <Row k="Git commit" v={gen.git_commit_short} />
              <Row k="SHA-256" v={gen.sha256} />
              <Row k="포함 migration" v={`${gen.migrations_count}건 / ${gen.migrations_contract_sha256.slice(0, 16)}…`} />
            </dl>
          ) : null}
        </div>

        <Tabs defaultValue="windows">
          <TabsList>
            <TabsTrigger value="windows">Windows</TabsTrigger>
            <TabsTrigger value="macos">macOS</TabsTrigger>
          </TabsList>
          <TabsContent value="windows" className="pt-2">
            <div className="rounded-md border p-3">
              <div className="font-medium">QAIL-재해복구-패키지-생성.cmd</div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                <li>내려받은 ZIP을 마우스 오른쪽 → 「압축 풀기」로 폴더에 풉니다.</li>
                <li>풀린 폴더의 <code>QAIL-재해복구-패키지-생성.cmd</code> 를 더블클릭합니다.</li>
                <li>보안 경고가 나오면 「추가 정보 → 실행」을 선택합니다.</li>
              </ol>
            </div>
          </TabsContent>
          <TabsContent value="macos" className="pt-2">
            <div className="rounded-md border p-3">
              <div className="font-medium">QAIL-재해복구-패키지-생성.command</div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                <li>내려받은 ZIP을 더블클릭해 압축을 풉니다.</li>
                <li>풀린 폴더의 <code>QAIL-재해복구-패키지-생성.command</code> 를 더블클릭합니다.</li>
                <li>실행이 막히면 터미널에서 <code>chmod +x</code> 후 다시 실행하거나, 오른쪽 클릭 → 「열기」를 선택합니다.</li>
              </ol>
            </div>
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          두 런처는 동일한 공용 엔진(run.bundle.mjs)을 호출하므로 OS와 무관하게 같은 형식의 패키지가 만들어집니다.
        </p>


        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-1 font-medium">필요 준비사항</div>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              <li>Node.js LTS</li>
              <li>PostgreSQL 17.x client (pg_dump, pg_restore)</li>
              <li>운영 DB 접속정보</li>
              <li>백엔드 URL과 서버 키(service role)</li>
              <li>최종 ZIP 저장 폴더</li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              비밀번호와 서버 키는 이 화면에 입력하거나 저장하지 않습니다. 런처 실행 중에만 입력합니다.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-1 font-medium">사용 순서</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
              <li>환경 확인</li>
              <li>DB 접속정보 입력</li>
              <li>Storage 접속정보 입력</li>
              <li>저장 폴더 선택</li>
              <li>패키지 생성</li>
              <li>완료 ZIP과 run_receipt.json 확인</li>
              <li>아래 브라우저 검증 실행</li>
            </ol>
          </div>
        </div>

        <div className="rounded-md border p-3 space-y-3">
          <div className="font-medium">브라우저 로컬 검증</div>
          <p className="text-xs text-muted-foreground">
            선택한 파일은 이 브라우저에서만 읽습니다. 서버·저장소·DB로 전송하지 않습니다.
          </p>

          {!streamOk ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              이 브라우저에서는 대용량 검증을 지원하지 않습니다.
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">QAIL_DR_*.zip</Label>
                  <input
                    ref={zipRef}
                    type="file"
                    accept=".zip"
                    className="block w-full text-xs"
                    onChange={(e) => {
                      resetVerification();
                      setZipFile(e.target.files?.[0] ?? null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">run_receipt.json</Label>
                  <input
                    ref={receiptRef}
                    type="file"
                    accept=".json,application/json"
                    className="block w-full text-xs"
                    onChange={(e) => {
                      resetVerification();
                      setReceiptFile(e.target.files?.[0] ?? null);
                    }}
                  />
                </div>
              </div>
              <Button size="sm" onClick={runVerify} disabled={!zipFile || !receiptFile || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                검증 실행
              </Button>
              {busy && zipFile ? (
                <div className="text-xs text-muted-foreground">
                  읽는 중 {bytesToHumanDr(progress)} / {bytesToHumanDr(zipFile.size)}
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              검증 미완료 — {error}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2">
              <div
                className={`flex items-center gap-2 rounded-md border p-2 text-sm font-medium ${
                  verdict === "ok"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : verdict === "warn"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                {verdict === "ok" ? <CheckCircle2 className="h-4 w-4" /> : verdict === "warn" ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {verdict === "ok"
                  ? "로컬 재해복구 패키지 확인 완료"
                  : verdict === "warn"
                    ? "패키지는 일치하지만 작업 폴더 정리 경고가 있습니다"
                    : "패키지 검증 실패 — 항목 불일치"}
              </div>

              <ul className="space-y-1 text-xs">
                {result.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    {c.passed ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />
                    )}
                    <span>
                      {c.label}
                      {c.detail ? <span className="text-muted-foreground"> — {c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <Row k="생성시각" v={result.summary.createdAt ?? "-"} />
                <Row k="DB dump" v={`${bytesToHumanDr(result.summary.dumpBytes)} / ${result.summary.dumpSha256 ?? "-"}`} />
                <Row k="Storage" v={`${result.summary.storageFiles ?? "-"}개 / ${bytesToHumanDr(result.summary.storageBytes)}`} />
                <Row k="최종 ZIP" v={`${bytesToHumanDr(result.summary.zipBytes)} / ${result.summary.zipSha256 ?? "-"}`} />
                <Row k="포함 보관함" v={DR_BUCKETS.join(", ")} />
                <Row k="제외 보관함" v={DR_EXCLUDED_BUCKET} />
                <Row k="작업 폴더 경고" v={result.summary.cleanupWarning ?? "없음"} />
              </dl>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="dr-saved"
                  checked={saved}
                  disabled={verdict === "fail"}
                  onCheckedChange={(v) => setSaved(v === true)}
                />
                <Label htmlFor="dr-saved" className="text-xs">
                  이 ZIP과 run_receipt.json을 로컬 백업 폴더에 함께 저장했습니다.
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                이 확인은 화면 표시용이며 서버에 기록되지 않습니다.
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all font-mono">{v}</dd>
    </div>
  );
}
