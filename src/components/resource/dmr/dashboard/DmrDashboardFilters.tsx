import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PERIOD_LABEL, type PeriodKind } from '@/lib/dmr/productivity';
import {
  EMPTY_FILTERS,
  filtersAreEmpty,
  type DmrDashFilters,
  type DmrDashOptions,
  type QualityFilter,
} from '@/lib/dmr/dashboard-model';
import { FilterToggleButton, MultiSelectPopover } from './ui';

const PERIOD_KINDS: PeriodKind[] = ['day', 'week', 'month', 'range', 'all'];

const QUALITY_OPTIONS: Array<{ value: QualityFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'productive', label: '실적 있음' },
  { value: 'noProgress', label: '무실적' },
  { value: 'corrected', label: '진도 정정' },
  { value: 'exceptional', label: '인원 없이 실적' },
  { value: 'dateGap', label: 'Data Date 격차' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export function DmrDashboardFilters({
  kind,
  onKind,
  baseDate,
  onBaseDate,
  from,
  to,
  onFrom,
  onTo,
  periodLabel,
  filters,
  onFilters,
  options,
}: {
  kind: PeriodKind;
  onKind: (k: PeriodKind) => void;
  baseDate: string;
  onBaseDate: (v: string) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  periodLabel: string;
  filters: DmrDashFilters;
  onFilters: (next: DmrDashFilters) => void;
  options: DmrDashOptions;
}) {
  const set = <K extends keyof DmrDashFilters>(k: K, v: DmrDashFilters[K]) =>
    onFilters({ ...filters, [k]: v });

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="기준일 (Data Date)">
          <Input
            type="date"
            value={baseDate}
            onChange={(e) => onBaseDate(e.target.value)}
            className="h-8 w-40 text-xs"
          />
        </Field>
        <Field label="기간">
          <div className="flex flex-wrap gap-1">
            {PERIOD_KINDS.map((k) => (
              <FilterToggleButton key={k} active={kind === k} className="h-8 px-2 text-[11px]" onClick={() => onKind(k)}>
                {PERIOD_LABEL[k]}
              </FilterToggleButton>
            ))}
          </div>
        </Field>
        {kind === 'range' && (
          <Field label="From ~ To">
            <div className="flex gap-1">
              <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="h-8 w-36 text-xs" />
              <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
          </Field>
        )}
        <Field label="Plot">
          <div className="flex gap-1">
            {options.plots.map((p) => (
              <FilterToggleButton
                key={p}
                active={filters.plots.includes(p)}
                className="w-10 px-0"
                onClick={() =>
                  set('plots', filters.plots.includes(p) ? filters.plots.filter((v) => v !== p) : [...filters.plots, p])
                }
              >
                {p}
              </FilterToggleButton>
            ))}
          </div>
        </Field>
        <Field label="Team (공종)">
          <div className="flex gap-1">
            {options.teams.map((t) => (
              <FilterToggleButton
                key={t}
                active={filters.teams.includes(t)}
                onClick={() =>
                  set('teams', filters.teams.includes(t) ? filters.teams.filter((v) => v !== t) : [...filters.teams, t])
                }
              >
                {t}
              </FilterToggleButton>
            ))}
          </div>
        </Field>
        <Field label="Sub Contractor">
          <MultiSelectPopover
            label="Sub Contractor"
            options={options.contractors}
            value={filters.contractors}
            onChange={(v) => set('contractors', v)}
          />
        </Field>
        <Field label="유형">
          <div className="flex gap-1">
            {(['all', 'direct', 'sub'] as const).map((v) => (
              <FilterToggleButton
                key={v}
                active={filters.contractorType === v}
                onClick={() => set('contractorType', v)}
              >
                {v === 'all' ? 'All' : v === 'direct' ? '직영' : '협력사'}
              </FilterToggleButton>
            ))}
          </div>
        </Field>
        <Field label="System / Work Description">
          <MultiSelectPopover
            label="System"
            options={options.systems}
            value={filters.systems}
            onChange={(v) => set('systems', v)}
          />
        </Field>
        {options.workTypes.length > 1 && (
          <Field label="Work Type">
            <MultiSelectPopover
              label="Work Type"
              options={options.workTypes}
              value={filters.workTypes}
              onChange={(v) => set('workTypes', v)}
            />
          </Field>
        )}
        {options.headcountKinds.length > 1 && (
          <Field label="인원 종류">
            <MultiSelectPopover
              label="Kind"
              options={options.headcountKinds}
              value={filters.headcountKinds}
              onChange={(v) => set('headcountKinds', v)}
            />
          </Field>
        )}
        <Field label="TM Code">
          <MultiSelectPopover
            label="TM Code"
            options={options.codes}
            value={filters.codes}
            onChange={(v) => set('codes', v)}
          />
        </Field>
        <Field label="검색 (Code · Task)">
          <Input
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="코드 또는 과업명"
            className="h-8 w-52 text-xs"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">품질</span>
        {QUALITY_OPTIONS.map((o) => (
          <FilterToggleButton
            key={o.value}
            active={filters.quality === o.value}
            className="h-7 px-2 text-[11px]"
            onClick={() => set('quality', o.value)}
          >
            {o.label}
          </FilterToggleButton>
        ))}
        <Badge variant="outline" className="ml-auto text-[10px]">
          {periodLabel}
        </Badge>
        {!filtersAreEmpty(filters) && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => onFilters(EMPTY_FILTERS)}>
            필터 초기화
          </Button>
        )}
      </div>
    </div>
  );
}
