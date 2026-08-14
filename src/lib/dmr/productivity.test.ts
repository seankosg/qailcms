import { describe, expect, it } from 'vitest';
import { normActual } from './productivity';

describe('normActual — 실적 정규화 정본 (서버 복제 없음)', () => {
  it('0.25 는 그대로', () => expect(normActual(0.25)).toBe(0.25));
  it('25 는 /100', () => expect(normActual(25)).toBe(0.25));
  it('null 은 0', () => expect(normActual(null ?? 0)).toBe(0));
  it('150 은 1 로 자름', () => expect(normActual(150)).toBe(1));
});
