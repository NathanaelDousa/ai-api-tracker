// ============================================================================
// Provider Registry
// ============================================================================
//
// Central map of all supported AI providers. The action uses this to
// dynamically look up a provider by its string ID (stored in per-tile
// action settings) and call the correct fetcher.
//
// To add a new provider:
//   1. Create src/services/{name}Service.ts
//   2. Import its fetcher here
//   3. Add an entry to PROVIDERS below
//   4. Update the Property Inspector's dropdown
//   5. Add its API key to GlobalSettings (types.ts)
//   6. Add a key field to the Property Inspector
// ============================================================================

import type { ProviderConfig, ProviderFetcher } from "./types";

// -- Real implementations ---------------------------------------------------

import { fetchOpenAIUsage } from "./openaiService";

// -- Placeholder implementations -------------------------------------------
// These throw { kind: "coming-soon" } until they're implemented.

import { fetchClaudeUsage } from "./claudeService";
import { fetchGeminiUsage } from "./geminiService";
import { fetchDeepSeekUsage } from "./deepseekService";

// -- Registry ---------------------------------------------------------------

/** Ordered list of all providers (determines display order in PI dropdown). */
export const ALL_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    fetcher: fetchOpenAIUsage,
    keySetting: "openaiApiKey",
    color: "#10a37f",
    implemented: true,
    iconPath: "imgs/providers/openai",
  },
  {
    id: "claude",
    name: "Claude",
    fetcher: fetchClaudeUsage,
    keySetting: "claudeApiKey",
    color: "#d97706",
    implemented: true,
    iconPath: "imgs/providers/claude",
  },
  {
    id: "gemini",
    name: "Gemini",
    fetcher: fetchGeminiUsage,
    keySetting: "geminiApiKey",
    color: "#4285f4",
    implemented: true,
    iconPath: "imgs/providers/gemini",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    fetcher: fetchDeepSeekUsage,
    keySetting: "deepseekApiKey",
    color: "#6366f1",
    implemented: true,
    iconPath: "imgs/providers/deepseek",
  },
];

/** Fast lookup map: provider ID → ProviderConfig */
const PROVIDER_MAP = new Map(ALL_PROVIDERS.map(p => [p.id, p] as const));

/**
 * Get a provider config by ID.
 * Returns undefined if the ID is not in the registry (shouldn't happen
 * unless action settings are corrupted).
 */
export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDER_MAP.get(id);
}

/**
 * The default provider ID used when a fresh tile is placed
 * (before the user selects one in the Property Inspector).
 */
export const DEFAULT_PROVIDER_ID = ALL_PROVIDERS[0].id;
