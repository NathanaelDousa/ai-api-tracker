import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { clearProviderCache, withProviderCache } = await importTs("../src/services/providerCache.ts");

test("provider cache dedupes in-flight fetches and reuses fresh successes", async () => {
  clearProviderCache();
  let calls = 0;
  let resolveFetch;
  const fetcher = async () => {
    calls++;
    return await new Promise((resolve) => {
      resolveFetch = resolve;
    });
  };
  const cached = withProviderCache("openai", fetcher, 10_000);

  const first = cached({ openaiApiKey: "one", openaiMonthlyBudget: 20 });
  const second = cached({ openaiMonthlyBudget: 20, openaiApiKey: "one" });
  assert.equal(calls, 1);

  resolveFetch({
    dailyTokens:     0,
    dailyCost:       1,
    budgetTotal:     20,
    budgetRemaining: 19,
    lastUpdated:     Date.now(),
  });

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);

  const third = await cached({ openaiApiKey: "one", openaiMonthlyBudget: 20 });
  assert.equal(third, a);
  assert.equal(calls, 1);

  let resolveSecondFetch;
  const fourth = cached({ openaiApiKey: "one", openaiMonthlyBudget: 30 });
  assert.equal(calls, 2);
  resolveSecondFetch = resolveFetch;
  resolveSecondFetch({
    dailyTokens:     0,
    dailyCost:       2,
    budgetTotal:     30,
    budgetRemaining: 28,
    lastUpdated:     Date.now(),
  });
  assert.equal((await fourth).dailyCost, 2);
});

test("provider cache clears failed in-flight requests", async () => {
  clearProviderCache();
  let calls = 0;
  const cached = withProviderCache("claude", async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return {
      dailyTokens:     0,
      dailyCost:       3,
      budgetTotal:     10,
      budgetRemaining: 7,
      lastUpdated:     Date.now(),
    };
  }, 10_000);

  await assert.rejects(() => cached({ claudeApiKey: "bad" }), /boom/);
  assert.equal((await cached({ claudeApiKey: "bad" })).dailyCost, 3);
  assert.equal(calls, 2);
});

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
