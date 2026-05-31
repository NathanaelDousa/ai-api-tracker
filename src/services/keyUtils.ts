export function normalizeSecret(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isClaudeAdminKey(value: unknown): boolean {
  return normalizeSecret(value).startsWith("sk-ant-admin");
}
