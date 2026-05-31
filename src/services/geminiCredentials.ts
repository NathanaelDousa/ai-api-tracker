import fs from "node:fs";
import type { FetchError, GlobalSettings } from "./types";

export interface GeminiServiceAccount {
  type:         string;
  client_email: string;
  private_key:  string;
  project_id:   string;
}

export function readGeminiServiceAccount(gs: GlobalSettings): GeminiServiceAccount {
  const importedJson = typeof gs.geminiServiceAccountJson === "string"
    ? gs.geminiServiceAccountJson.trim()
    : "";
  if (importedJson) {
    return parseServiceAccountJson(importedJson, "imported SA JSON");
  }

  const saPath = typeof gs.geminiServiceAccountPath === "string"
    ? gs.geminiServiceAccountPath.trim()
    : "";
  if (!saPath) {
    throw { kind: "service-account-missing" } satisfies FetchError;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(saPath, "utf8");
  } catch (err: unknown) {
    throw {
      kind:    "service-account-invalid",
      message: `Cannot read SA file: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies FetchError;
  }

  return parseServiceAccountJson(raw, "SA file");
}

function parseServiceAccountJson(raw: string, source: string): GeminiServiceAccount {
  let sa: GeminiServiceAccount;
  try {
    sa = JSON.parse(raw) as GeminiServiceAccount;
  } catch (err: unknown) {
    throw {
      kind:    "service-account-invalid",
      message: `Cannot parse ${source}: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies FetchError;
  }

  if (sa.type !== "service_account" || !sa.client_email || !sa.private_key) {
    throw {
      kind:    "service-account-invalid",
      message: "Invalid service account JSON",
    } satisfies FetchError;
  }

  return sa;
}
