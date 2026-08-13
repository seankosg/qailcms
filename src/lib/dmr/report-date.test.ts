import { describe, it, expect } from 'vitest';
import { normalizeDmrReportDate, assertNotFutureReportDate } from './report-date';

describe('normalizeDmrReportDate', () => {
  it('reads day-first two-digit years', () => {
    expect(normalizeDmrReportDate('11/8/26')).toBe('2026-08-11');
    expect(normalizeDmrReportDate('12/8/26')).toBe('2026-08-12');
    expect(normalizeDmrReportDate('11/Aug/26')).toBe('2026-08-11');
    expect(normalizeDmrReportDate('11-08-2026')).toBe('2026-08-11');
    expect(normalizeDmrReportDate('2026-08-11')).toBe('2026-08-11');
  });
  it('throws on unknown shapes instead of guessing', () => {
    expect(() => normalizeDmrReportDate('Aug 11')).toThrow();
    expect(() => normalizeDmrReportDate('')).toThrow();
    expect(() => normalizeDmrReportDate('31/2/26')).toThrow();
  });
  it('rejects future dates', () => {
    expect(() => assertNotFutureReportDate('2026-11-08', '2026-08-13')).toThrow();
    expect(() => assertNotFutureReportDate('2026-08-11', '2026-08-13')).not.toThrow();
  });
});
