import streamDeck from "@elgato/streamdeck";
import type { UsageData, FetchError, GlobalSettings } from "./types";
import { configuredBalance, providerBudget } from "./budget";
import { normalizeSecret } from "./keyUtils";
import { parseOpenAICreditBalance } from "./openaiBalance";
import {
  estimateCompletionUsage,
  estimateEmbeddingUsage,
  overlayLiveEstimateOnSettledCosts,
  type OpenAICompletionUsage,
  type OpenAIEmbeddingUsage,
} from "./openaiEstimator";
import { recordAndGetTrend } from "./trendStore";

// GET /v1/organization/costs — requires an Admin API key.
// Returns actual billed USD amounts per day bucket, but can lag behind live
// API activity. We pair it with GET /v1/organization/usage/completions for
// today's token counts, then price those with a local table as a best-effort
// live estimate until the Costs API catches up.

const MAX_PAGES = 10;
const CREDIT_GRANTS_URL = "https://api.openai.com/dashboard/billing/credit_grants";

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

interface UsageBucket {
  start_time: number;
  end_time:   number;
  results:    OpenAICompletionUsage[];
}

interface OrgCompletionsUsageResponse {
  data:      UsageBucket[];
  has_more:  boolean;
  next_page: string | null;
}

interface EmbeddingUsageBucket {
  start_time: number;
  end_time:   number;
  results:    OpenAIEmbeddingUsage[];
}

interface OrgEmbeddingsUsageResponse {
  data:      EmbeddingUsageBucket[];
  has_more:  boolean;
  next_page: string | null;
}

interface LiveUsageEstimate {
  cost: number;
  tokens: number;
  unpricedModels: string[];
  notes: string[];
}

export async function fetchOpenAIUsage(gs: GlobalSettings): Promise<UsageData> {
  const apiKey = normalizeSecret(gs.openaiApiKey);
  const budget = providerBudget(gs, "openaiMonthlyBudget");
  const dashboardBalance = configuredBalance(gs, "openaiCreditBalance");

  if (!apiKey) {
    throw { kind: "no-api-key" } satisfies FetchError;
  }

  const now     = new Date();
  const startTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  const nowTs   = Math.floor(now.getTime() / 1000);
  const todayTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  // Costs API validates at day granularity — start and end must be on different
  // calendar dates. On the first of the month startTs == todayTs (same day),
  // so we extend endTs to tomorrow midnight to guarantee start < end date-wise.
  const endTs   = Math.max(nowTs, startTs + 86400);

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

  let settledMonthlyCost = 0;
  let settledDailyCost   = 0;

  for (const bucket of allBuckets) {
    for (const r of (bucket.results ?? [])) {
      settledMonthlyCost += Number(r.amount?.value) || 0;
    }
    if (bucket.start_time >= todayTs) {
      for (const r of (bucket.results ?? [])) {
        settledDailyCost += Number(r.amount?.value) || 0;
      }
    }
  }

  streamDeck.logger.info(
    `[OpenAI] settledMonthlyCost=$${settledMonthlyCost.toFixed(4)} settledDailyCost=$${settledDailyCost.toFixed(4)} budget=$${budget}`,
  );

  const [liveEstimate, platformBalance] = await Promise.all([
    fetchLiveUsageEstimateSafely(apiKey, todayTs, nowTs),
    budget > 0 || dashboardBalance != null ? Promise.resolve(null) : fetchCreditBalanceSafely(apiKey),
  ]);
  const overlay = overlayLiveEstimateOnSettledCosts(
    settledDailyCost,
    settledMonthlyCost,
    liveEstimate?.cost,
  );

  if (liveEstimate) {
    streamDeck.logger.info(
      `[OpenAI] liveEstimate=$${liveEstimate.cost.toFixed(4)} tokens=${liveEstimate.tokens} estimateDelta=$${overlay.estimateDelta.toFixed(4)}`,
    );
    if (liveEstimate.unpricedModels.length > 0) {
      streamDeck.logger.warn(
        `[OpenAI] unpriced models skipped in live estimate: ${liveEstimate.unpricedModels.join(", ")}`,
      );
    }
    if (liveEstimate.notes.length > 0) {
      streamDeck.logger.warn(`[OpenAI] live estimate notes: ${liveEstimate.notes.join("; ")}`);
    }
  }
  if (budget === 0 && dashboardBalance != null) {
    streamDeck.logger.info(`[OpenAI] using configured dashboard balance=$${dashboardBalance.toFixed(2)}`);
  }

  const trend = recordAndGetTrend("openai", round3(overlay.dailyCost));

  return {
    dailyTokens:     liveEstimate?.tokens ?? 0,
    dailyCost:       round3(overlay.dailyCost),
    monthlyCost:     round2(overlay.monthlyCost),
    trend,
    isEstimate:      overlay.isEstimate ? true : undefined,
    balanceRemaining: (platformBalance ?? dashboardBalance) ?? undefined,
    budgetTotal:     budget,
    budgetRemaining: budget > 0 ? round2(budget - overlay.monthlyCost) : 0,
    lastUpdated:     Date.now(),
  };
}

async function fetchCreditBalanceSafely(apiKey: string): Promise<number | null> {
  try {
    const balance = await fetchCreditBalance(apiKey);
    if (balance != null) {
      streamDeck.logger.info(`[OpenAI] platform credit balance=$${balance.toFixed(2)}`);
    }
    return balance;
  } catch (err: unknown) {
    streamDeck.logger.warn(
      `[OpenAI] credit balance unavailable; showing spend only: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function fetchCreditBalance(apiKey: string): Promise<number | null> {
  let response: Response;
  try {
    response = await fetch(CREDIT_GRANTS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(10_000),
    });
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
  }

  const payload = await response.json();
  return parseOpenAICreditBalance(payload);
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

async function fetchLiveUsageEstimateSafely(
  apiKey: string,
  todayTs: number,
  endTs: number,
): Promise<LiveUsageEstimate | null> {
  try {
    return await fetchLiveUsageEstimate(apiKey, todayTs, endTs);
  } catch (err: unknown) {
    streamDeck.logger.warn(
      `[OpenAI] live usage estimate unavailable; falling back to settled costs: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function fetchLiveUsageEstimate(
  apiKey: string,
  startTs: number,
  endTs: number,
): Promise<LiveUsageEstimate> {
  const [completionOutcome, embeddingOutcome] = await Promise.allSettled([
    fetchCompletionUsageResults(apiKey, startTs, endTs),
    fetchEmbeddingUsageResults(apiKey, startTs, endTs),
  ]);
  const completionResults = completionOutcome.status === "fulfilled" ? completionOutcome.value : [];
  const embeddingResults = embeddingOutcome.status === "fulfilled" ? embeddingOutcome.value : [];
  const endpointNotes: string[] = [];

  if (completionOutcome.status === "rejected") {
    endpointNotes.push(`completions usage unavailable: ${String(completionOutcome.reason)}`);
  }
  if (embeddingOutcome.status === "rejected") {
    endpointNotes.push(`embeddings usage unavailable: ${String(embeddingOutcome.reason)}`);
  }

  const completionEstimate = estimateCompletionUsage(completionResults);
  const embeddingEstimate = estimateEmbeddingUsage(embeddingResults);
  const tokens = completionResults.reduce((sum, r) => {
    return sum +
      positive(r.input_tokens) +
      positive(r.input_audio_tokens) +
      positive(r.output_tokens) +
      positive(r.output_audio_tokens);
  }, 0) + embeddingResults.reduce((sum, r) => sum + positive(r.input_tokens), 0);

  return {
    cost: completionEstimate.cost + embeddingEstimate.cost,
    tokens,
    unpricedModels: uniqueSorted([
      ...completionEstimate.unpricedModels,
      ...embeddingEstimate.unpricedModels,
    ]),
    notes: uniqueSorted([
      ...completionEstimate.notes,
      ...embeddingEstimate.notes,
      ...endpointNotes,
    ]),
  };
}

async function fetchCompletionUsageResults(
  apiKey: string,
  startTs: number,
  endTs: number,
): Promise<OpenAICompletionUsage[]> {
  const allResults: OpenAICompletionUsage[] = [];
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      start_time:   String(startTs),
      end_time:     String(endTs),
      bucket_width: "1d",
      limit:        "1",
    });
    params.append("group_by", "model");
    params.append("group_by", "batch");
    params.append("group_by", "service_tier");
    if (pageToken) params.set("page", pageToken);

    const url = `https://api.openai.com/v1/organization/usage/completions?${params.toString()}`;
    streamDeck.logger.info(`[OpenAI] fetching live usage: ${url}`);
    const page = await fetchUsagePage(apiKey, url);
    for (const bucket of page.data ?? []) {
      allResults.push(...(bucket.results ?? []));
    }
    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return allResults;
}

async function fetchEmbeddingUsageResults(
  apiKey: string,
  startTs: number,
  endTs: number,
): Promise<OpenAIEmbeddingUsage[]> {
  const allResults: OpenAIEmbeddingUsage[] = [];
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const params = new URLSearchParams({
      start_time:   String(startTs),
      end_time:     String(endTs),
      bucket_width: "1d",
      limit:        "1",
    });
    params.append("group_by", "model");
    if (pageToken) params.set("page", pageToken);

    const url = `https://api.openai.com/v1/organization/usage/embeddings?${params.toString()}`;
    streamDeck.logger.info(`[OpenAI] fetching live embedding usage: ${url}`);
    const page = await fetchEmbeddingsPage(apiKey, url);
    for (const bucket of page.data ?? []) {
      allResults.push(...(bucket.results ?? []));
    }
    pageToken = page.has_more ? (page.next_page ?? null) : null;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return allResults;
}

async function fetchUsagePage(apiKey: string, url: string): Promise<OrgCompletionsUsageResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<OrgCompletionsUsageResponse>;
}

async function fetchEmbeddingsPage(apiKey: string, url: string): Promise<OrgEmbeddingsUsageResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<OrgEmbeddingsUsageResponse>;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function positive(n: unknown): number {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function round2(n: number): number { return Math.round(n * 100)  / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
