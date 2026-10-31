// Conservative purchased-PACKAGE bounds. A wallet debit does not identify paid vs free funds.
// Never invent a FIFO allocation and present it as a factual paid-credit balance.
export function packageBalanceBounds(buyer, payments, movements) {
  const ps = payments
    .filter((p) => p.uid === buyer.user_id)
    .sort(
      (a, b) =>
        Date.parse(a.paid_at || a.created_at) -
        Date.parse(b.paid_at || b.created_at),
    );
  const totalIssued = ps.reduce(
      (s, p) => s + Math.max(0, Number(p.credits) || 0),
      0,
    ),
    wallet = Math.max(0, Number(buyer.credits) || 0);
  const rows = movements
    .filter((r) => r.user_id === buyer.user_id)
    .sort(
      (a, b) =>
        Date.parse(a.changed_at) - Date.parse(b.changed_at) ||
        Number(a.id) - Number(b.id),
    );
  if (!rows.length)
    return {
      lower: 0,
      upper: Math.min(wallet, totalIssued) * 10,
      matched: 0,
      payments: ps.length,
      reconciled: false,
    };
  let lower = 0,
    upper = Math.min(
      Math.max(0, Number(rows[0].old_credits) || 0),
      totalIssued,
    ),
    last = null,
    gaps = false;
  const matched = new Set();
  for (const r of rows) {
    const before = Number(r.old_credits),
      after = Number(r.new_credits),
      delta = Number(r.delta);
    if (
      ![before, after, delta].every(Number.isFinite) ||
      Math.abs(after - before - delta) > 0.0001
    ) {
      gaps = true;
      continue;
    }
    if (last !== null && Math.abs(before - last) > 0.0001) {
      lower = 0;
      upper = Math.min(Math.max(0, before), totalIssued);
      gaps = true;
    }
    const grant = ps.find(
      (p) =>
        String(p.id) === String(r.payment_id) &&
        Math.abs(Number(p.credits) - delta) < 0.0001 &&
        !matched.has(p.id),
    );
    if (delta > 0 && grant) {
      matched.add(grant.id);
      lower += delta;
      upper += delta;
    } else if (delta > 0) {
      // Could be a refund of previously paid funds. Keep that possibility, capped by issued package credits.
      upper = Math.min(totalIssued, upper + delta);
    } else if (delta < 0) {
      lower = Math.max(0, lower + delta);
      upper = Math.min(upper, Math.max(0, after));
    }
    lower = Math.min(totalIssued, lower, Math.max(0, after));
    upper = Math.max(lower, Math.min(totalIssued, upper, Math.max(0, after)));
    last = after;
  }
  if (
    last === null ||
    Math.abs(last - wallet) > 0.0001 ||
    matched.size < ps.length
  ) {
    lower = 0;
    upper = Math.min(wallet, totalIssued);
    gaps = true;
  }
  return {
    lower: Math.round(lower * 1000000) / 100000,
    upper: Math.round(upper * 1000000) / 100000,
    matched: matched.size,
    payments: ps.length,
    reconciled: !gaps && Math.abs(upper - lower) < 0.0001,
  };
}
