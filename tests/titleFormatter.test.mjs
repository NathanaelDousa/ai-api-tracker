import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { formatUsageTitle } = await importTs("../src/actions/titleFormatter.ts");
const {
  estimateCompletionUsage,
  estimateEmbeddingUsage,
  overlayLiveEstimateOnSettledCosts,
  resolveOpenAIEmbeddingPrice,
  resolveOpenAITextPrice,
} = await importTs("../src/services/openaiEstimator.ts");
const { providerBudget } = await importTs("../src/services/budget.ts");
const { isClaudeAdminKey, normalizeSecret } = await importTs("../src/services/keyUtils.ts");
const now = Date.UTC(2026, 4, 30, 12, 0, 0);
const lastUpdated = now - 2 * 60 * 1000;

test("renders USD trend in standard mode", () => {
  const title = formatUsageTitle("OpenAI", {
    dailyTokens:     0,
    dailyCost:       0.231,
    monthlyCost:     12.5,
    trend:           0.052,
    budgetTotal:     50,
    budgetRemaining: 37.5,
    lastUpdated,
  }, { now });

  assert.equal(title, "OpenAI\n$37.50 left\n$12.50 /mo\n↑$0.05 · 2m");
});

test("marks estimated USD values with a tilde", () => {
  const title = formatUsageTitle("OpenAI", {
    dailyTokens:     1200,
    dailyCost:       0.512,
    monthlyCost:     12.61,
    trend:           0.052,
    isEstimate:      true,
    budgetTotal:     50,
    budgetRemaining: 37.39,
    lastUpdated,
  }, { now });

  assert.equal(title, "OpenAI\n~$37.39 left\n~$12.61 /mo\n↑~$0.05 · 2m");
});

test("renders request-count trend for Gemini-style request units", () => {
  const title = formatUsageTitle("Gemini", {
    dailyTokens:     340,
    dailyCost:       0,
    trend:           200,
    budgetTotal:     0,
    budgetRemaining: 0,
    lastUpdated,
    unit:            "requests",
  }, { now });

  assert.equal(title, "Gemini\n340 req today\n↑200 req · 2m");
});

test("hides trend line when display settings disable it", () => {
  const title = formatUsageTitle("Gemini", {
    dailyTokens:     340,
    dailyCost:       0,
    trend:           200,
    budgetTotal:     0,
    budgetRemaining: 0,
    lastUpdated,
    unit:            "requests",
  }, { now, showTrend: false });

  assert.equal(title, "Gemini\n340 req today\n2m ago");
});

test("focus modes keep the large single-number display", () => {
  const title = formatUsageTitle("Gemini", {
    dailyTokens:     340,
    dailyCost:       0,
    trend:           200,
    budgetTotal:     0,
    budgetRemaining: 0,
    lastUpdated,
    unit:            "requests",
  }, { now, displayMode: "big-daily" });

  assert.equal(title, "Gemini\n340 req");
});

test("property inspector exposes current settings and providers", async () => {
  const html = await readFile(new URL("../com.nathanaeldousa.ai-api-tracker.sdPlugin/ui/tracker-settings.html", import.meta.url), "utf8");

  // Tile display settings
  assert.match(html, /<sdpi-item label="Trend line">/);
  assert.match(html, /<sdpi-select setting="showTrend">/);
  assert.match(html, /<option value="yes" selected>Show<\/option>/);
  assert.match(html, /<option value="no">Hide<\/option>/);

  // Gemini uses text path field (file picker was removed — sandboxed webview blocks file reads)
  assert.match(html, /setting="geminiServiceAccountPath"/);
  assert.doesNotMatch(html, /id="gemini-service-account-file"/);
  assert.match(html, /setting="geminiMonthlyBudget"/);

  // DeepSeek manual exchange rate
  assert.match(html, /setting="deepseekCnyToUsdRate"/);

  // New providers present in dropdown and accordion
  assert.match(html, /value="openrouter"/);
  assert.match(html, /setting="openrouterApiKey"/);
  assert.match(html, /value="grok"/);
  assert.match(html, /setting="grokApiKey"/);
});

test("normalizes pasted provider secrets before prefix checks", () => {
  assert.equal(normalizeSecret("  sk-ant-admin01-example\n"), "sk-ant-admin01-example");
  assert.equal(isClaudeAdminKey("  sk-ant-admin01-example\n"), true);
  assert.equal(isClaudeAdminKey("sk-ant-api03-example"), false);
});

test("provider budgets do not fall back to legacy shared monthlyBudget", () => {
  assert.equal(providerBudget({
    monthlyBudget:         2,
    deepseekMonthlyBudget: 2,
  }, "claudeMonthlyBudget"), 0);
  assert.equal(providerBudget({
    monthlyBudget:         2,
    deepseekMonthlyBudget: 2,
  }, "deepseekMonthlyBudget"), 2);
});

test("estimates OpenAI completion spend using cached-token pricing", () => {
  const estimate = estimateCompletionUsage([{
    model:               "gpt-4o-2024-08-06",
    input_tokens:        1000,
    input_cached_tokens: 400,
    output_tokens:       250,
  }]);

  assert.equal(round6(estimate.cost), 0.0045);
  assert.deepEqual(estimate.unpricedModels, []);
});

test("applies OpenAI batch discount and emits estimate notes", () => {
  const estimate = estimateCompletionUsage([{
    model:         "gpt-4o-2024-08-06",
    batch:         true,
    service_tier:  "priority",
    input_tokens:  1000,
    output_tokens: 250,
  }]);

  assert.equal(round6(estimate.cost), 0.0025);
  assert.deepEqual(estimate.notes, [
    "batch requests estimated at 50% of standard token pricing",
    "service tier 'priority' estimated with standard token pricing",
  ]);
});

test("estimates OpenAI embedding usage", () => {
  const estimate = estimateEmbeddingUsage([{
    model:        "text-embedding-3-small",
    input_tokens: 1_000_000,
  }]);

  assert.equal(estimate.cost, 0.02);
  assert.equal(resolveOpenAIEmbeddingPrice("text-embedding-3-large-2026-01-01"), 0.13);
});

test("overlays live OpenAI estimates without double-counting settled costs", () => {
  const staleCosts = overlayLiveEstimateOnSettledCosts(0.10, 12.00, 0.35);
  assert.equal(staleCosts.dailyCost, 0.35);
  assert.equal(staleCosts.monthlyCost, 12.25);
  assert.equal(round6(staleCosts.estimateDelta), 0.25);
  assert.equal(staleCosts.isEstimate, true);

  const caughtUpCosts = overlayLiveEstimateOnSettledCosts(0.40, 12.00, 0.35);
  assert.deepEqual(caughtUpCosts, {
    dailyCost:     0.40,
    monthlyCost:   12.00,
    estimateDelta: 0,
    isEstimate:    false,
  });
});

test("reports unpriced OpenAI models without charging them", () => {
  const estimate = estimateCompletionUsage([{
    model:         "some-new-model",
    input_tokens:  1000,
    output_tokens: 1000,
  }]);

  assert.equal(estimate.cost, 0);
  assert.deepEqual(estimate.unpricedModels, ["some-new-model"]);
});

test("resolves dated OpenAI model snapshots from stable pricing aliases", () => {
  assert.deepEqual(resolveOpenAITextPrice("gpt-4o-2024-08-06"), {
    input:       2.5,
    cachedInput: 1.25,
    output:      10,
  });
});

function round6(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

async function importTs(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  return import(url);
}
