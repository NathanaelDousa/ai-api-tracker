import fs from "node:fs";
import path from "node:path";
import streamDeck from "@elgato/streamdeck";

// ============================================================================
// Trend Store — daily metric delta tracking
// ============================================================================
//
// Persists today's and yesterday's metric per provider in trend-store.json.
// Used by providers with daily spend or request-count readings to show a
// "today vs yesterday" indicator on the tile.
//
// Storage: {cwd}/trend-store.json  (same convention as deepseek-spend.json)

const STORE_PATH = path.join(process.cwd(), "trend-store.json");

interface DayRecord {
  date:  string;  // "YYYY-MM-DD" UTC
  value: number;  // USD or request count, depending on provider/unit
}

type TrendStore = Record<string, {
  today:     DayRecord;
  yesterday: DayRecord | null;
}>;

function load(): TrendStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const store: TrendStore = {};
    for (const [provider, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as { today?: unknown; yesterday?: unknown };
      const today = normalizeDayRecord(entry.today);
      if (!today) continue;
      store[provider] = {
        today,
        yesterday: entry.yesterday == null ? null : normalizeDayRecord(entry.yesterday),
      };
    }
    return store;
  } catch {
    return {};
  }
}

function normalizeDayRecord(raw: unknown): DayRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as { date?: unknown; value?: unknown; spend?: unknown };
  const rawValue = record.value ?? record.spend;
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  return {
    date:  typeof record.date === "string" ? record.date : todayUTC(),
    value: Number.isFinite(value) ? value : 0,
  };
}

function persist(store: TrendStore): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), "utf8");
  } catch (err: unknown) {
    streamDeck.logger.warn(`[TrendStore] save failed: ${String(err)}`);
  }
}

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function previousUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Record the latest daily metric reading for a provider and return the trend
 * delta (today - yesterday). Returns undefined when no yesterday data
 * exists yet (i.e. the first day the plugin has seen data for this provider).
 *
 * The store takes the MAX of the previous today value and the new reading so
 * API lag (which sometimes makes early-morning values look lower than they
 * really are) doesn't produce a false negative trend.
 */
export function recordAndGetTrend(provider: string, todayValue: number): number | undefined {
  const today = todayUTC();
  const store = load();
  const entry = store[provider];

  if (!entry) {
    // First ever reading for this provider.
    store[provider] = { today: { date: today, value: todayValue }, yesterday: null };
    persist(store);
    return undefined;
  }

  if (entry.today.date === today) {
    // Same calendar day: update value (take max to handle API lag).
    entry.today.value = Math.max(entry.today.value, todayValue);
    store[provider] = entry;
    persist(store);
    return entry.yesterday != null
      ? entry.today.value - entry.yesterday.value
      : undefined;
  }

  if (entry.today.date < today) {
    // New calendar day: promote today -> yesterday only when readings are consecutive.
    const prevToday = entry.today;
    const yesterday = prevToday.date === previousUTC() ? prevToday : null;
    store[provider] = {
      today:     { date: today, value: todayValue },
      yesterday,
    };
    persist(store);
    // Trend: today's running total vs yesterday's final total.
    return yesterday != null ? todayValue - yesterday.value : undefined;
  }

  // Stored date is in the future (clock skew / DST edge case) — reset.
  store[provider] = { today: { date: today, value: todayValue }, yesterday: null };
  persist(store);
  return undefined;
}
