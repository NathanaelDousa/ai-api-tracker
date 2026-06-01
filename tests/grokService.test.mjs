import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

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

const { fetchGrokUsage } = await importService("../src/services/grokService.ts");

function mockFetch(status, body) {
  global.fetch = async () => ({
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => body,
    text:   async () => JSON.stringify(body),
  });
}

const BASE_SETTINGS = { grokApiKey: "xai-test-key" };

test("grok: parses flat response shape", async () => {
  mockFetch(200, { usage_usd: 3.00, limit_usd: 10.00 });
  const d = await fetchGrokUsage(BASE_SETTINGS);

  assert.equal(d.monthlyCost,     3.00);
  assert.equal(d.spendPeriod,     "total");
  assert.equal(d.dailyCostUnavailable, true);
  assert.equal(d.budgetTotal,     10.00);
  assert.equal(d.budgetRemaining, 7.00);
});

test("grok: parses nested response shape under .data", async () => {
  mockFetch(200, { data: { usage_usd: 2.50, limit_usd: 15.00 } });
  const d = await fetchGrokUsage(BASE_SETTINGS);

  assert.equal(d.monthlyCost,     2.50);
  assert.equal(d.spendPeriod,     "total");
  assert.equal(d.budgetTotal,     15.00);
  assert.equal(d.budgetRemaining, 12.50);
});

test("grok: uses remaining_usd directly when provided", async () => {
  mockFetch(200, { usage_usd: 4.00, limit_usd: 10.00, remaining_usd: 6.50 });
  const d = await fetchGrokUsage(BASE_SETTINGS);

  assert.equal(d.budgetRemaining, 6.50);
});

test("grok: falls back to configured budget when no limit in response", async () => {
  mockFetch(200, { usage_usd: 1.00 });
  const d = await fetchGrokUsage({ ...BASE_SETTINGS, grokMonthlyBudget: 25 });

  assert.equal(d.budgetTotal,     25);
  assert.equal(d.budgetRemaining, 24.00);
});

test("grok: uses configured dashboard balance when API omits remaining credit", async () => {
  mockFetch(200, { usage_usd: 1.00 });
  const d = await fetchGrokUsage({ ...BASE_SETTINGS, grokCreditBalance: 8.75 });

  assert.equal(d.balanceRemaining, 8.75);
  assert.equal(d.budgetTotal,      0);
});

test("grok: throws no-api-key when key is absent", async () => {
  await assert.rejects(
    () => fetchGrokUsage({}),
    (err) => err.kind === "no-api-key",
  );
});

test("grok: throws bad-api-key on 401", async () => {
  mockFetch(401, { error: "Incorrect API key provided" });
  await assert.rejects(
    () => fetchGrokUsage(BASE_SETTINGS),
    (err) => err.kind === "bad-api-key" && err.status === 401,
  );
});

test("grok: throws rate-limited on 429", async () => {
  mockFetch(429, {});
  await assert.rejects(
    () => fetchGrokUsage(BASE_SETTINGS),
    (err) => err.kind === "rate-limited",
  );
});
