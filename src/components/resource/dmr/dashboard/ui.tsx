import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const LINE_COLORS = [
  '#2563eb', '#ef4444', '#f59e0b', '#10b981', '#06b6d4',
  '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

/** 실적 = 실선, 계획 = 같은 색 점선. 색 규칙은 바꾸지 않는다. */
export const ACTUAL_COLOR = '#2563eb';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(iso: string) {
  if (!iso || iso.length < 10) return iso;
  const [, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1] ?? m}`;
}

export function FilterToggleButton({
  active,
  className,
  children,
  onClick,
  title,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  subColor = 'muted',
  hint,
  right,
  onClick,
}: {
  label: string;
  value: number | string;
  sub?: ReactNode;
  subColor?: 'emerald' | 'amber' | 'red' | 'muted';
  hint?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card className={cn(onClick && 'cursor-pointer transition-colors hover:bg-accent/40')}>
      <CardContent className="p-4" onClick={onClick}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-2xl font-bold">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
            {sub && (
              <div
                className={cn(
                  'mt-1 text-xs font-medium',
                  subColor === 'emerald'
                    ? 'text-emerald-600'
                    : subColor === 'amber'
                      ? 'text-amber-600'
                      : subColor === 'red'
                        ? 'text-red-600'
                        : 'text-muted-foreground',
                )}
              >
                {sub}
              </div>
            )}
            {hint && <div className="mt-1 text-[10px] leading-tight text-muted-foreground">{hint}</div>}
          </div>
          {right && <div className="shrink-0 text-right">{right}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function MultiSelectPopover({
  label,
  options,
  value,
  onChange,
  width = 'min-w-[10rem]',
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options),
    [options, query],
  );
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  const btnLabel = value.length === 0 ? `All ${label}` : `${value.length} selected`;
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className={cn('h-8 justify-between text-xs', width)}
      >
        <span className="truncate">{btnLabel}</span>
        <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          <Input
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-8 text-xs"
          />
          <div className="mb-2 flex justify-between text-[11px]">
            <button className="text-primary hover:underline" onClick={() => onChange(filtered)}>
              Select all
            </button>
            <button className="text-muted-foreground hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-2 text-center text-xs text-muted-foreground">No options</div>
            )}
            {filtered.map((o) => (
              <label
                key={o}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={value.includes(o)}
                  onChange={() => toggle(o)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
