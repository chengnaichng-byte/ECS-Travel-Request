// §17 Charging roll-up — pure helpers shared by the charging editor (live preview) and
// the saveCharging server action. Given per-cost-line charging assignments, aggregate the
// NTU-funded amount per charging account and derive the effective request-level percentage
// split. That effective split is what is persisted to ChargingAllocation, so all downstream
// routing (§13.14 highest-share DOA, §18 cross-BA, §6.2 funding owner) and the review /
// finance breakdowns keep working unchanged whichever entry mode the user picked.

export interface RollupRow {
  chargingCode: string;
  amountSgd: number;
  percent: number; // share of the total allocated amount (one decimal)
}

/** Aggregate line-level charges into one row per charging account. */
export function rollupByCode(lines: { chargingCode: string; netSgd: number }[]): RollupRow[] {
  const byCode = new Map<string, number>();
  for (const l of lines) {
    if (!l.chargingCode) continue;
    byCode.set(l.chargingCode, (byCode.get(l.chargingCode) ?? 0) + l.netSgd);
  }
  const total = [...byCode.values()].reduce((s, v) => s + v, 0) || 1;
  return [...byCode.entries()].map(([chargingCode, amountSgd]) => ({
    chargingCode,
    amountSgd: Math.round(amountSgd * 100) / 100,
    percent: Math.round((amountSgd / total) * 1000) / 10,
  }));
}

export interface EffectiveRow { chargingCode: string; percent: number; amountSgd: number | null; internalOrder: string | null; isMain: boolean; }

/** Parse the ECS ChargingAccountEditor form (MAIN | CLAIM | ITEM) into the effective
 *  ChargingAllocation rows + the per-line map. Shared by the TR and TE save actions so the
 *  canonical split (which drives routing) is produced identically on both sides. */
export interface LineAlloc { code: string; pct: number; io: string }

export function resolveChargingRows(
  fd: Pick<FormData, 'get'>,
  expenses: { id: string; sgdAmount: number; sponsorSgd: number }[],
  total: number,
  defaultCode: string,
): { mode: 'MAIN' | 'CLAIM' | 'ITEM'; rows: EffectiveRow[]; lineMap: Record<string, string>; lineAllocs: Record<string, LineAlloc[]> } {
  const s = (k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : ''; };
  const n = (k: string) => { const v = parseFloat(s(k)); return Number.isFinite(v) ? v : 0; };
  const raw = s('chargingMode');
  const mode = raw === 'CLAIM' || raw === 'ITEM' ? raw : 'MAIN';
  const mainCode = s('mainCode') || defaultCode;
  const lineMap: Record<string, string> = {};
  const lineAllocs: Record<string, LineAlloc[] | undefined> = {};

  if (mode === 'ITEM') {
    // §17 each (per-traveller) cost line carries its OWN split across one or more accounts; the
    // request-level ChargingAllocation rows are the roll-up of net × pct over every line × split.
    const charges: { chargingCode: string; netSgd: number }[] = [];
    for (const e of expenses) {
      const net = Math.max(e.sgdAmount - e.sponsorSgd, 0);
      let allocs: LineAlloc[] = [];
      const rawJson = s(`line_${e.id}_allocs`);
      if (rawJson) { try { allocs = (JSON.parse(rawJson) as LineAlloc[]).filter((a) => a.code && Number(a.pct) > 0).map((a) => ({ code: a.code, pct: Number(a.pct), io: a.io || '' })); } catch { allocs = []; } }
      if (!allocs.length) { const code = s(`line_${e.id}`) || mainCode; if (code) allocs = [{ code, pct: 100, io: '' }]; }
      lineAllocs[e.id] = allocs;
      lineMap[e.id] = allocs[0]?.code || mainCode;
      for (const a of allocs) charges.push({ chargingCode: a.code, netSgd: net * (a.pct / 100) });
    }
    const rows = rollupByCode(charges).map((r) => ({ chargingCode: r.chargingCode, percent: r.percent, amountSgd: r.amountSgd, internalOrder: null, isMain: r.chargingCode === mainCode }));
    return { mode, rows, lineMap, lineAllocs: cleanAllocs(lineAllocs) };
  }

  if (mode === 'CLAIM') {
    const rows: EffectiveRow[] = [];
    for (let i = 0; i < 50; i++) {
      const code = s(`row_code_${i}`);
      if (!code) break;
      const pct = n(`row_pct_${i}`);
      if (pct <= 0) continue;
      rows.push({ chargingCode: code, percent: pct, amountSgd: Math.round((pct / 100) * total * 100) / 100, internalOrder: s(`row_io_${i}`) || null, isMain: code === mainCode });
    }
    return { mode, rows, lineMap, lineAllocs: {} };
  }

  const rows: EffectiveRow[] = mainCode ? [{ chargingCode: mainCode, percent: 100, amountSgd: total, internalOrder: null, isMain: true }] : [];
  return { mode, rows, lineMap, lineAllocs: {} };
}

function cleanAllocs(m: Record<string, LineAlloc[] | undefined>): Record<string, LineAlloc[]> {
  const out: Record<string, LineAlloc[]> = {};
  for (const [k, v] of Object.entries(m)) if (v && v.length) out[k] = v;
  return out;
}

/** Roll up request-level rows (percent or amount entry) into normalised rows. */
export function rollupRequestRows(
  rows: { chargingCode: string; percent?: number; amountSgd?: number }[],
  ntuFunded: number,
  amountMode: boolean,
): RollupRow[] {
  const live = rows.filter((r) => r.chargingCode);
  if (amountMode) {
    const total = live.reduce((s, r) => s + (r.amountSgd ?? 0), 0) || 1;
    return live
      .filter((r) => (r.amountSgd ?? 0) > 0)
      .map((r) => ({ chargingCode: r.chargingCode, amountSgd: r.amountSgd ?? 0, percent: Math.round(((r.amountSgd ?? 0) / total) * 1000) / 10 }));
  }
  return live
    .filter((r) => (r.percent ?? 0) > 0)
    .map((r) => ({ chargingCode: r.chargingCode, percent: r.percent ?? 0, amountSgd: Math.round(((r.percent ?? 0) / 100) * ntuFunded * 100) / 100 }));
}
