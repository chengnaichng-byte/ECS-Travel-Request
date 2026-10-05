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
