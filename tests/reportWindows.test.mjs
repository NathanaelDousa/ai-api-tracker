import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { buildClaudeReportWindow } = await importTs("../src/services/reportWindows.ts");

test("Claude report window avoids same-day Anthropic date validation on month day one", () => {
  const now = new Date("2026-06-01T08:22:03.000Z");
  const window = buildClaudeReportWindow(now);

  assert.equal(window.startingAt, "2026-05-31T00:00:00.000Z");
  assert.equal(window.endingAt, "2026-06-01T08:22:03.000Z");
  assert.equal(window.monthStartDate, "2026-06-01");
  assert.equal(window.todayDate, "2026-06-01");
});

test("Claude report window starts at month boundary after the first UTC day", () => {
  const window = buildClaudeReportWindow(new Date("2026-06-02T08:22:03.000Z"));

  assert.equal(window.startingAt, "2026-06-01T00:00:00.000Z");
  assert.equal(window.endingAt, "2026-06-02T08:22:03.000Z");
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
