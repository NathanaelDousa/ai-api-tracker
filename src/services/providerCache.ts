import type { GlobalSettings, ProviderFetcher, UsageData } from "./types";

interface CacheEntry {
  key: string;
  expiresAt: number;
  value?: UsageData;
  inFlight?: Promise<UsageData>;
}

const DEFAULT_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export function withProviderCache(
  providerId: string,
  fetcher: ProviderFetcher,
  ttlMs = DEFAULT_TTL_MS,
): ProviderFetcher {
  return async (settings: GlobalSettings): Promise<UsageData> => {
    const key = stableStringify(settings);
    const now = Date.now();
    const existing = cache.get(providerId);

    if (existing?.key === key) {
      if (existing.value && existing.expiresAt > now) {
        return existing.value;
      }
      if (existing.inFlight) {
        return existing.inFlight;
      }
    }

    const inFlight = fetcher(settings)
      .then((value) => {
        cache.set(providerId, {
          key,
          value,
          expiresAt: Date.now() + ttlMs,
        });
        return value;
      })
      .catch((err: unknown) => {
        if (cache.get(providerId)?.inFlight === inFlight) {
          cache.delete(providerId);
        }
        throw err;
      });

    cache.set(providerId, {
      key,
      inFlight,
      expiresAt: now + ttlMs,
    });

    return inFlight;
  };
}

export function clearProviderCache(providerId?: string): void {
  if (providerId) {
    cache.delete(providerId);
    return;
  }
  cache.clear();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
