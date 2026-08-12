import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportDmrRange, type DmrExportDiscipline } from '@/lib/dmr/export-dmr-range';

const TEAMS: DmrExportDiscipline[] = ['ARCH', 'ELEC', 'MECH'];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** 기본 기간 — 작성 화면의 기준일 */
  defaultDate: string;
}

export function DmrExportDialog({ open, onOpenChange, defaultDate }: Props) {
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [teams, setTeams] = useState<DmrExportDiscipline[]>([...TEAMS]);
  const [fileMode, setFileMode] = useState<'single' | 'per-subcon'>('single');
  const [sheetMode, setSheetMode] = useState<'single' | 'per-date'>('single');
  const [busy, setBusy] = useState(false);

  const toggleTeam = (t: DmrExportDiscipline, on: boolean) =>
    setTeams((prev) => (on ? [...new Set([...prev, t])] : prev.filter((x) => x !== t)));

  const run = async () => {
    setBusy(true);
    const id = toast.loading('내보내는 중…');
    try {
      const r = await exportDmrRange({
        from,
        to,
        disciplines: TEAMS.filter((t) => teams.includes(t)),
        fileMode,
        sheetMode,
      });
      toast.success(
        `${r.rowCount.toLocaleString()}행 · ${r.files}개 파일${r.zipped ? ' (ZIP)' : ''} 내보내기 완료`,
        { id },
      );
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`내보내기 실패: ${e?.message ?? e}`, { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>DMR Daily Entry — 내보내기</DialogTitle>
          <DialogDescription>기간·팀을 고르고 파일·시트 나눔 방식을 정합니다.</DialogDescription>
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
            <div className="flex flex-wrap gap-4">
              {TEAMS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={teams.includes(t)} onCheckedChange={(v) => toggleTeam(t, v === true)} />
                  {t}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">파일</div>
            <RadioGroup value={fileMode} onValueChange={(v) => setFileMode(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="single" id="dmr-file-single" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-file-single" className="text-sm font-medium">한 파일</Label>
                  <p className="mt-1 text-xs text-muted-foreground">고른 기간·팀 전체를 .xlsx 하나로.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="per-subcon" id="dmr-file-subcon" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-file-subcon" className="text-sm font-medium">Sub Contractor 별 파일</Label>
                  <p className="mt-1 text-xs text-muted-foreground">업체가 7곳 이상이면 ZIP 으로 묶습니다.</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">시트</div>
            <RadioGroup value={sheetMode} onValueChange={(v) => setSheetMode(v as any)} className="gap-2">
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="single" id="dmr-sheet-single" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-sheet-single" className="text-sm font-medium">한 시트</Label>
                  <p className="mt-1 text-xs text-muted-foreground">기간 전체를 한 시트에 이어서.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="per-date" id="dmr-sheet-date" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="dmr-sheet-date" className="text-sm font-medium">날짜별 시트</Label>
                  <p className="mt-1 text-xs text-muted-foreground">보고일마다 시트를 나눕니다.</p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button size="sm" onClick={() => void run()} disabled={busy || teams.length === 0}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? '내보내는 중…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
