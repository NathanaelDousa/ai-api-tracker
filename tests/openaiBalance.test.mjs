import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { parseOpenAICreditBalance } = await importTs("../src/services/openaiBalance.ts");

test("reads OpenAI platform balance from credit grants total_available", () => {
  assert.equal(parseOpenAICreditBalance({ total_available: 12.345 }), 12.35);
});

test("falls back to granted minus used for OpenAI platform balance", () => {
  assert.equal(parseOpenAICreditBalance({ total_granted: 20, total_used: 7.5 }), 12.5);
});

test("sums nested OpenAI grant balances when present", () => {
  assert.equal(parseOpenAICreditBalance({
    grants: {
      data: [
        { amount: { available: 1.2 } },
        { amount: { available: "3.4" } },
      ],
    },
  }), 4.6);
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
