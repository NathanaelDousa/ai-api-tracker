import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";

// GET /v1/organization/costs — requires an Admin API key.
// Returns actual billed USD amounts per day bucket, avoiding hardcoded
// per-model rate tables that go stale as OpenAI changes pricing.

const MAX_PAGES = 10;

interface CostAmount {
  value:    number;
  currency: string;
}

interface CostResult {
  amount: CostAmount;
}

interface CostBucket {
  start_time: number;
  end_time:   number;
  results:    CostResult[];
}

interface OrgCostsResponse {
  data:      CostBucket[];
  has_more:  boolean;
  next_page: string | null;
}

export async function fetchOpenAIUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = gs.openaiApiKey;
  const budget = Math.max(0, Number(gs.openaiMonthlyBudget ?? gs.monthlyBudget) || 0);

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  const now     = new Date();
  const startTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  const endTs   = Math.floor(now.getTime() / 1000);
  const todayTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);

  const allBuckets: CostBucket[] = [];
  let pageToken: string | null = null;
  let pages = 0;

  do {
    // Request up to 90 daily buckets (3 months worth) so the whole billing
    // period fits on one page and we avoid cursor pagination, which is
    // unreliable on OpenAI's Costs API (the cursor expires quickly).
    // On page 2+ pass only the encoded cursor — repeating start/end time
    // causes a 400 "have you modified the query parameters?" error.
    const url = pageToken
      ? `https://api.openai.com/v1/organization/costs?limit=90&page=${encodeURIComponent(pageToken)}`
      : `https://api.openai.com/v1/organization/costs?start_time=${startTs}&end_time=${endTs}&limit=90`;

    streamDeck.logger.info(`[OpenAI] fetching: ${url}`);
    const page = await fetchPage(apiKey, url);
    allBuckets.push(...page.data);
    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  streamDeck.logger.info(
    `[OpenAI] pages=${pages} buckets=${allBuckets.length}`,
  );

  let monthlyCost = 0;
  let dailyCost   = 0;

  for (const bucket of allBuckets) {
    for (const r of (bucket.results ?? [])) {
      monthlyCost += r.amount.value ?? 0;
    }
    if (bucket.start_time >= todayTs) {
      for (const r of (bucket.results ?? [])) {
        dailyCost += r.amount.value ?? 0;
      }
    }
  }

  return {
    dailyTokens:     0,
    dailyCost:       round3(dailyCost),
    monthlyCost:     round2(monthlyCost),
    budgetTotal:     budget,
    budgetRemaining: round2(budget - monthlyCost),
    lastUpdated:     Date.now(),
  };
}

async function fetchPage(apiKey: string, url: string): Promise<OrgCostsResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw {
      kind:    "network-error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies FetchError;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    streamDeck.logger.error(`[OpenAI] HTTP ${response.status}: ${body}`);

    if (response.status === 401 || response.status === 403) {
      throw { kind: "bad-api-key", status: response.status } satisfies FetchError;
    }
    if (response.status === 429) {
      const ra = parseInt(response.headers.get("retry-after") ?? "", 10);
      throw { kind: "rate-limited", retryAfter: Number.isNaN(ra) ? undefined : ra } satisfies FetchError;
    }
    throw { kind: "api-error", status: response.status } satisfies FetchError;
  }

  return response.json() as Promise<OrgCostsResponse>;
}

function round2(n: number): number { return Math.round(n * 100)  / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
