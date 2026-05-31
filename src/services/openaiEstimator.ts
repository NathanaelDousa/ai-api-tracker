export interface OpenAIModelPrice {
  input: number;
  cachedInput?: number;
  output: number;
}

export interface OpenAICompletionUsage {
  model?: string | null;
  batch?: boolean | null;
  service_tier?: string | null;
  input_tokens?: number;
  input_cached_tokens?: number;
  input_audio_tokens?: number;
  output_tokens?: number;
  output_audio_tokens?: number;
}

export interface OpenAIEmbeddingUsage {
  model?: string | null;
  input_tokens?: number;
}

export interface OpenAIEstimate {
  cost: number;
  unpricedModels: string[];
  notes: string[];
}

export interface OpenAICostOverlay {
  dailyCost: number;
  monthlyCost: number;
  estimateDelta: number;
  isEstimate: boolean;
}

// USD per 1M tokens. Keep exact keys and broad aliases here; lookup sorts by
// longest key so snapshots like gpt-4o-2024-08-06 inherit the gpt-4o rate.
// Sources: OpenAI pricing docs and current API pricing page.
export const OPENAI_TEXT_PRICING: Record<string, OpenAIModelPrice> = {
  "gpt-5.5":                    { input: 5.00,   cachedInput: 0.50,  output: 30.00 },
  "gpt-5.4-mini":               { input: 0.75,   cachedInput: 0.075, output: 4.50 },
  "gpt-5.4":                    { input: 2.50,   cachedInput: 0.25,  output: 15.00 },

  "gpt-5.2-chat-latest":        { input: 1.75,   cachedInput: 0.175, output: 14.00 },
  "gpt-5.1-chat-latest":        { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5-chat-latest":          { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5.2-codex":              { input: 1.75,   cachedInput: 0.175, output: 14.00 },
  "gpt-5.1-codex-max":          { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5.1-codex-mini":         { input: 0.25,   cachedInput: 0.025, output: 2.00 },
  "gpt-5.1-codex":              { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5-codex":                { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5.2-pro":                { input: 21.00,                    output: 168.00 },
  "gpt-5-pro":                  { input: 15.00,                    output: 120.00 },
  "gpt-5.2":                    { input: 1.75,   cachedInput: 0.175, output: 14.00 },
  "gpt-5.1":                    { input: 1.25,   cachedInput: 0.125, output: 10.00 },
  "gpt-5-mini":                 { input: 0.25,   cachedInput: 0.025, output: 2.00 },
  "gpt-5-nano":                 { input: 0.05,   cachedInput: 0.005, output: 0.40 },
  "gpt-5":                      { input: 1.25,   cachedInput: 0.125, output: 10.00 },

  "gpt-4o-2024-05-13":          { input: 5.00,                     output: 15.00 },
  "gpt-4o-mini-audio-preview":  { input: 0.15,                    output: 0.60 },
  "gpt-4o-audio-preview":       { input: 2.50,                    output: 10.00 },
  "gpt-4o-mini-search-preview": { input: 0.15,                    output: 0.60 },
  "gpt-4o-search-preview":      { input: 2.50,                    output: 10.00 },
  "gpt-4o-mini":                { input: 0.15,   cachedInput: 0.075, output: 0.60 },
  "gpt-4o":                     { input: 2.50,   cachedInput: 1.25,  output: 10.00 },
  "chatgpt-4o-latest":          { input: 5.00,                     output: 15.00 },

  "gpt-4.1-mini":               { input: 0.40,   cachedInput: 0.10,  output: 1.60 },
  "gpt-4.1-nano":               { input: 0.10,   cachedInput: 0.025, output: 0.40 },
  "gpt-4.1":                    { input: 2.00,   cachedInput: 0.50,  output: 8.00 },
  "gpt-4.5-preview":            { input: 75.00,                    output: 150.00 },

  "o4-mini-deep-research":      { input: 2.00,   cachedInput: 0.50,  output: 8.00 },
  "o3-deep-research":           { input: 10.00,  cachedInput: 2.50,  output: 40.00 },
  "o3-pro":                     { input: 20.00,                    output: 80.00 },
  "o3-mini":                    { input: 1.10,   cachedInput: 0.55,  output: 4.40 },
  "o4-mini":                    { input: 1.10,   cachedInput: 0.275, output: 4.40 },
  "o1-pro":                     { input: 150.00,                   output: 600.00 },
  "o1-mini":                    { input: 1.10,   cachedInput: 0.55,  output: 4.40 },
  "o1":                         { input: 15.00,  cachedInput: 7.50,  output: 60.00 },
  "o3":                         { input: 2.00,   cachedInput: 0.50,  output: 8.00 },

  "codex-mini-latest":          { input: 1.50,   cachedInput: 0.375, output: 6.00 },
  "computer-use-preview":       { input: 3.00,                     output: 12.00 },
  "gpt-audio-mini":             { input: 0.60,                    output: 2.40 },
  "gpt-audio":                  { input: 2.50,                    output: 10.00 },
  "gpt-realtime-mini":          { input: 0.60,   cachedInput: 0.06,  output: 2.40 },
  "gpt-realtime":               { input: 4.00,   cachedInput: 0.40,  output: 16.00 },
};

export const OPENAI_EMBEDDING_PRICING: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
  "text-embedding-ada-002": 0.10,
};

const PRICE_KEYS = Object.keys(OPENAI_TEXT_PRICING).sort((a, b) => b.length - a.length);
const EMBEDDING_PRICE_KEYS = Object.keys(OPENAI_EMBEDDING_PRICING).sort((a, b) => b.length - a.length);

export function estimateCompletionUsage(results: OpenAICompletionUsage[]): OpenAIEstimate {
  const unpricedModels = new Set<string>();
  const notes = new Set<string>();
  let cost = 0;

  for (const result of results) {
    const model = result.model ?? "";
    const price = resolveOpenAITextPrice(model);
    if (!price) {
      unpricedModels.add(model || "unknown");
      continue;
    }
    cost += estimateCompletionResult(result, price);

    if (result.batch === true) {
      notes.add("batch requests estimated at 50% of standard token pricing");
    }
    if (result.service_tier && !["default", "standard"].includes(result.service_tier)) {
      notes.add(`service tier '${result.service_tier}' estimated with standard token pricing`);
    }
  }

  return {
    cost,
    unpricedModels: [...unpricedModels].sort(),
    notes: [...notes].sort(),
  };
}

export function estimateEmbeddingUsage(results: OpenAIEmbeddingUsage[]): OpenAIEstimate {
  const unpricedModels = new Set<string>();
  let cost = 0;

  for (const result of results) {
    const model = result.model ?? "";
    const price = resolveOpenAIEmbeddingPrice(model);
    if (price == null) {
      unpricedModels.add(model || "unknown");
      continue;
    }
    cost += positive(result.input_tokens) * price / 1_000_000;
  }

  return { cost, unpricedModels: [...unpricedModels].sort(), notes: [] };
}

export function overlayLiveEstimateOnSettledCosts(
  settledDailyCost: number,
  settledMonthlyCost: number,
  liveEstimateCost: number | null | undefined,
): OpenAICostOverlay {
  const settledDaily = positive(settledDailyCost);
  const settledMonth = positive(settledMonthlyCost);
  const dailyCost = liveEstimateCost == null
    ? settledDaily
    : Math.max(settledDaily, positive(liveEstimateCost));
  const estimateDelta = Math.max(0, dailyCost - settledDaily);

  return {
    dailyCost,
    monthlyCost: settledMonth + estimateDelta,
    estimateDelta,
    isEstimate: estimateDelta > 0.0005,
  };
}

export function estimateCompletionResult(result: OpenAICompletionUsage, price: OpenAIModelPrice): number {
  const inputTokens       = positive(result.input_tokens);
  const cachedTokens      = Math.min(positive(result.input_cached_tokens), inputTokens);
  const uncachedTokens    = Math.max(0, inputTokens - cachedTokens);
  const inputAudioTokens  = positive(result.input_audio_tokens);
  const outputTokens      = positive(result.output_tokens);
  const outputAudioTokens = positive(result.output_audio_tokens);
  const cachedRate        = price.cachedInput ?? price.input;

  const multiplier = result.batch === true ? 0.5 : 1;
  return multiplier * (
    uncachedTokens    * price.input +
    cachedTokens      * cachedRate +
    inputAudioTokens  * price.input +
    outputTokens      * price.output +
    outputAudioTokens * price.output
  ) / 1_000_000;
}

export function resolveOpenAITextPrice(model: string | null | undefined): OpenAIModelPrice | undefined {
  const normalized = (model ?? "").toLowerCase();
  for (const key of PRICE_KEYS) {
    if (normalized === key || normalized.startsWith(`${key}-`)) {
      return OPENAI_TEXT_PRICING[key];
    }
  }
  return undefined;
}

export function resolveOpenAIEmbeddingPrice(model: string | null | undefined): number | undefined {
  const normalized = (model ?? "").toLowerCase();
  for (const key of EMBEDDING_PRICE_KEYS) {
    if (normalized === key || normalized.startsWith(`${key}-`)) {
      return OPENAI_EMBEDDING_PRICING[key];
    }
  }
  return undefined;
}

function positive(n: unknown): number {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
