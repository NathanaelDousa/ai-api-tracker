import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Import helper — patches relative service imports to data URLs so the module
// loads cleanly outside the Stream Deck runtime.
// ---------------------------------------------------------------------------

const compilerOptions = {
  module: ts.ModuleKind.ES2022,
  target: ts.ScriptTarget.ES2022,
  importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
};

async function toDataUrl(relativePath) {
  const src = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(src, { compilerOptions });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

async function importService(relativePath) {
  const [budgetUrl, keyUtilsUrl] = await Promise.all([
    toDataUrl("../src/services/budget.ts"),
    toDataUrl("../src/services/keyUtils.ts"),
  ]);

  // Node.js v25 cannot resolve bare specifiers from data: URLs.
  // Stub @elgato/streamdeck (logger) and trendStore (no-op) so the service
  // logic runs without the Stream Deck runtime.
  const sdUrl         = `data:text/javascript,export default{logger:{info(){},'warn'(){},'error'(){}}}`;
  const trendStoreUrl = `data:text/javascript,export function recordAndGetTrend(){return undefined;}`;

  const src = await readFile(new URL(relativePath, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(src, { compilerOptions });

  outputText = outputText
    .replace('"@elgato/streamdeck"', `"${sdUrl}"`)
    .replace('"./budget"',           `"${budgetUrl}"`)
    .replace('"./keyUtils"',         `"${keyUtilsUrl}"`)
    .replace('"./trendStore"',       `"${trendStoreUrl}"`);

  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  return import(url);
}

const { fetchOpenRouterUsage } = await importService("../src/services/openrouterService.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(routes) {
  global.fetch = async (url) => {
    const href = String(url);
    const route = href.endsWith("/api/v1/key") ? routes.key : routes.credits;
    const status = route?.status ?? 500;
    const body = route?.body ?? {};
    return {
      ok:     status >= 200 && status < 300,
      status,
      json:   async () => body,
      text:   async () => JSON.stringify(body),
    };
  };
}

const BASE_SETTINGS = { openrouterApiKey: "sk-or-test-key" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("openrouter: uses account credits as live balance", async () => {
  mockFetch({
    credits: { status: 200, body: { data: { total_credits: 20.00, total_usage: 5.00 } } },
    key:     { status: 200, body: { data: { usage: 5.00, usage_daily: 0.50, usage_monthly: 3.00, limit: null, is_free_tier: false } } },
  });
  const d = await fetchOpenRouterUsage(BASE_SETTINGS);

  assert.equal(d.balanceRemaining, 15.00);
  assert.equal(d.monthlyCost,      3.00);
  assert.equal(d.dailyCost,        0.50);
  assert.equal(d.spendPeriod,      "month");
  assert.equal(d.budgetTotal,      0);
});

test("openrouter: falls back to configured budget when no hard limit", async () => {
  mockFetch({
    credits: { status: 200, body: { data: { total_credits: 20.00, total_usage: 3.50 } } },
    key:     { status: 200, body: { data: { usage: 3.50, usage_monthly: 3.50, limit: null, is_free_tier: false } } },
  });
  const d = await fetchOpenRouterUsage({ ...BASE_SETTINGS, openrouterMonthlyBudget: 50 });

  assert.equal(d.balanceRemaining, undefined);
  assert.equal(d.monthlyCost,     3.50);
  assert.equal(d.spendPeriod,     "month");
  assert.equal(d.budgetTotal,     50);
  assert.equal(d.budgetRemaining, 46.50);
});

test("openrouter: labels usage as total even without a limit or configured budget", async () => {
  mockFetch({
    credits: { status: 200, body: { data: { total_credits: 20.00, total_usage: 3.50 } } },
    key:     { status: 500, body: {} },
  });
  const d = await fetchOpenRouterUsage(BASE_SETTINGS);

  assert.equal(d.monthlyCost,     3.50);
  assert.equal(d.spendPeriod,     "total");
  assert.equal(d.budgetTotal,     0);
  assert.equal(d.budgetRemaining, 0);
});

test("openrouter: remaining never goes below zero", async () => {
  mockFetch({
    credits: { status: 200, body: { data: { total_credits: 20.00, total_usage: 25.00 } } },
    key:     { status: 200, body: { data: { usage: 25.00, usage_monthly: 25.00, limit: null, is_free_tier: false } } },
  });
  const d = await fetchOpenRouterUsage(BASE_SETTINGS);

  assert.equal(d.balanceRemaining, 0);
});

test("openrouter: throws no-api-key when key is absent", async () => {
  await assert.rejects(
    () => fetchOpenRouterUsage({}),
    (err) => err.kind === "no-api-key",
  );
});

test("openrouter: throws bad-api-key on 401", async () => {
  mockFetch({
    credits: { status: 401, body: { error: { message: "Unauthorized", code: 401 } } },
  });
  await assert.rejects(
    () => fetchOpenRouterUsage(BASE_SETTINGS),
    (err) => err.kind === "bad-api-key" && err.status === 401,
  );
});

test("openrouter: throws rate-limited on 429", async () => {
  mockFetch({
    credits: { status: 429, body: { error: "rate limit" } },
  });
  await assert.rejects(
    () => fetchOpenRouterUsage(BASE_SETTINGS),
    (err) => err.kind === "rate-limited",
  );
});
