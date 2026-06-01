export function parseOpenAICreditBalance(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const direct = positiveNumber(root.total_available);
  if (direct != null) return round2(direct);

  const granted = positiveNumber(root.total_granted);
  const used = positiveNumber(root.total_used);
  if (granted != null && used != null) {
    return round2(Math.max(0, granted - used));
  }

  const grants = root.grants;
  if (!grants || typeof grants !== "object") return null;
  const data = (grants as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;

  let total = 0;
  let found = false;
  for (const grant of data) {
    if (!grant || typeof grant !== "object") continue;
    const amount = (grant as { amount?: unknown }).amount;
    if (!amount || typeof amount !== "object") continue;
    const available = positiveNumber((amount as { available?: unknown }).available);
    if (available == null) continue;
    total += available;
    found = true;
  }

  return found ? round2(total) : null;
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
