export function dec(n: any): any {
  if (n == null) return n;
  switch (n.t) {
    case 0: case 1: case 2: return n.s;
    case 9: return (n.a ?? []).map(dec);
    case 10: { const o: any = {}; n.p.k.forEach((k: string, i: number) => (o[k] = dec(n.p.v[i]))); return o; }
    case 25: return { __error: dec(n.s?.message) };
    default: return n.s !== undefined ? n.s : (n.a ? n.a.map(dec) : null);
  }
}
