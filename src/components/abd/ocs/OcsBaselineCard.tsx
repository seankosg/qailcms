import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Loader2, Database } from "lucide-react";
import { createOcsBaseline, signOcsBaseline, type BaselineResult } from "@/lib/abd/ocs-baseline.functions";
import { shortId } from "@/lib/abd/ocs-baseline-shared";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canAccessAbdOcs } from "@/lib/abd/ocs-access";
import { formatDdMmmYyyyHm } from "@/lib/time/doha";

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{String(value ?? "—")}</span>
    </div>
  );
}

export function OcsBaselineCard() {
  const { data: me } = useCurrentUser();
  const createFn = useServerFn(createOcsBaseline);
  const signFn = useServerFn(signOcsBaseline);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<BaselineResult | null>(null);

  if (!canAccessAbdOcs({ userType: me?.userType, team: me?.team, isStrictAdmin: me?.isStrictAdmin })) return null;

  async function onCreate() {
    setBusy("Baseline 생성 중… (정본 추출 → 해시 대조 → ZIP)");
    try {
      const out = (await createFn({})) as BaselineResult;
      setRes(out);
      toast.success(out.reused ? "동일 core — 기존 Baseline 재사용" : "Baseline 생성 완료");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    if (!res) return;
    try {
      const { signed_url } = (await signFn({ data: { storage_path: res.storage_path } })) as {
        signed_url: string;
      };
      window.open(signed_url || res.signed_url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" /> Latest OCS Baseline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          기존 QAIL OCS Increment 프로그램과 브라우저 로컬 검증에서 함께 사용하는 단일
          Baseline입니다. 이미지·Excel 바이너리는 제외되며 metadata·storage_path·content_hash 만
          포함합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!!busy} onClick={() => void onCreate()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Latest OCS Baseline 생성
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!res || !!busy}
            onClick={() => void onDownload()}
          >
            <Download className="mr-2 h-4 w-4" /> Download Latest OCS Baseline
          </Button>
          {res?.reused && (
            <Badge variant="outline" className="text-[11px]">
              동일 core — 기존 파일 재사용
            </Badge>
          )}
        </div>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {busy}
          </div>
        )}

        {res && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <Row label="baseline_id (short)" value={shortId(res.baseline_id)} />
              <Row label="schema_version" value={res.schema_version} />
              <Row label="운영 데이터셋" value={`${res.files.length}종`} />
              <Row
                label="Browser validation index"
                value={res.validation_files.length > 0 ? "포함" : "없음"}
              />
              <Row label="index row count" value={res.validation_row_count.toLocaleString()} />
              <Row label="core_hash (short)" value={shortId(res.core_hash)} />
              <Row label="generated_at" value={formatDdMmmYyyyHm(res.generated_at)} />
              <Row label="data_date (Doha)" value={res.data_date} />
              <Row label="latest import run" value={res.latest_success_import_run_id ?? "—"} />
            </div>
            <div className="rounded-md border p-3">
              <Row label="JSON 총 행수" value={res.total_rows.toLocaleString()} />
              <Row label="ZIP byte size" value={res.zip_byte_size.toLocaleString()} />
              <Row label="storage path" value={res.storage_path} />
              <Row label="signed URL 만료" value={`${res.signed_url_expires_in}s`} />
              <Row label="재사용 여부" value={res.reused ? "reused" : "new"} />
            </div>
            {res.files.length > 0 && (
              <div className="rounded-md border p-3 md:col-span-2">
                <div className="mb-1 text-xs font-semibold">JSON 파일별 행수 · SHA-256</div>
                <div className="grid gap-x-6 md:grid-cols-2">
                  {res.files.map((f) => (
                    <Row
                      key={f.name}
                      label={`${f.name} (${f.row_count.toLocaleString()}행)`}
                      value={`${f.sha256.slice(0, 12)}… / ${f.byte_size.toLocaleString()}B`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
