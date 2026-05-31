import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const { readGeminiServiceAccount } = await importTs("../src/services/geminiCredentials.ts");

const validServiceAccount = JSON.stringify({
  type:         "service_account",
  client_email: "gemini@example.iam.gserviceaccount.com",
  private_key:  "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  project_id:   "demo-project-123",
});

test("reads Gemini service account details from imported JSON settings", () => {
  const serviceAccount = readGeminiServiceAccount({
    geminiServiceAccountJson: validServiceAccount,
  });

  assert.equal(serviceAccount.client_email, "gemini@example.iam.gserviceaccount.com");
  assert.equal(serviceAccount.project_id, "demo-project-123");
});

test("prefers imported Gemini JSON over a legacy path", () => {
  const serviceAccount = readGeminiServiceAccount({
    geminiServiceAccountJson: validServiceAccount,
    geminiServiceAccountPath: "/path/that/does/not/exist.json",
  });

  assert.equal(serviceAccount.project_id, "demo-project-123");
});

test("rejects invalid imported Gemini JSON as a service-account error", () => {
  assert.throws(
    () => readGeminiServiceAccount({ geminiServiceAccountJson: "{\"type\":\"user\"}" }),
    (err) => err.kind === "service-account-invalid",
  );
});

test("requires Gemini credentials when neither imported JSON nor path is set", () => {
  assert.throws(
    () => readGeminiServiceAccount({}),
    (err) => err.kind === "service-account-missing",
  );
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
