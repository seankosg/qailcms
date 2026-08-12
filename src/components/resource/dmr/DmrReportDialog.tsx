import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { runDmrReport, type DmrReportTeam } from '@/lib/dmr/report-dmr';

const TEAMS: DmrReportTeam[] = ['ARCH', 'ELEC', 'MECH'];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultDate: string;
}

export function DmrReportDialog({ open, onOpenChange, defaultDate }: Props) {
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [teams, setTeams] = useState<DmrReportTeam[]>([...TEAMS]);
  const [dateMode, setDateMode] = useState<'single' | 'per-date'>('per-date');
  const [format, setFormat] = useState<'html' | 'pdf'>('html');
  const [busy, setBusy] = useState(false);

  const allOn = teams.length === TEAMS.length;
  const toggleTeam = (t: DmrReportTeam, on: boolean) =>
    setTeams((prev) => (on ? [...new Set([...prev, t])] : prev.filter((x) => x !== t)));

  const run = async () => {
    setBusy(true);
    const id = toast.loading('리포트 만드는 중…');
    try {
      const r = await runDmrReport({ from, to, teams: TEAMS.filter((t) => teams.includes(t)), dateMode, format });
      toast.success(`${r.rowCount.toLocaleString()}행으로 리포트를 열었습니다`, { id });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`리포트 실패: ${e?.message ?? e}`, { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Daily Manpower Mobilization Status — 리포트</DialogTitle>
          <DialogDescription>저장된 Raw Data 로 좌 Plot C · 우 Plot D 표를 만듭니다.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">기간</div>
            <div className="flex items-center gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
              <span className="text-xs text-muted-foreground">~</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">팀</div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allOn} onCheckedChange={(v) => setTeams(v === true ? [...TEAMS] : [])} />
                All
              </label>
              {TEAMS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={teams.includes(t)} onCheckedChange={(v) => toggleTeam(t, v === true)} />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">기간 나눔</div>
            <RadioGroup value={dateMode} onValueChange={(v) => setDateMode(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="per-date" id="dmr-rep-perdate" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-rep-perdate" className="text-sm font-medium">날짜별 표</Label>
                  <p className="mt-1 text-xs text-muted-foreground">보고일마다 표(페이지)를 나눕니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="single" id="dmr-rep-single" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-rep-single" className="text-sm font-medium">기간 합산</Label>
                  <p className="mt-1 text-xs text-muted-foreground">기간 전체를 팀마다 한 표로.</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">양식</div>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="html" id="dmr-rep-html" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-rep-html" className="text-sm font-medium">HTML</Label>
                  <p className="mt-1 text-xs text-muted-foreground">새 창으로 열립니다. 스크롤해도 상단 헤더가 고정됩니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="pdf" id="dmr-rep-pdf" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-rep-pdf" className="text-sm font-medium">PDF</Label>
                  <p className="mt-1 text-xs text-muted-foreground">인쇄 창이 열립니다(대상: PDF로 저장). 여러 장이면 페이지마다 헤더가 반복됩니다.</p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button size="sm" onClick={() => void run()} disabled={busy || teams.length === 0}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? '만드는 중…' : 'Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
