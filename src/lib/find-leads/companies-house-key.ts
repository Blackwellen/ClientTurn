/**
 * Companies House REST keys are UUIDs. Copied from some screens they lose
 * their dashes, and the API then answers 401 (found live 2026-09-28), so a
 * bare 32-hex key is put back into UUID form. Anything else passes through.
 *
 * Pure, so it is testable outside the server-only provider.
 */
export function normaliseCompaniesHouseKey(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return /^[0-9a-f]{32}$/i.test(value)
    ? value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
    : value;
}
