/**
 * Cold outreach template rendering.
 *
 * Pure: no `server-only`, no Supabase, no path alias — so the strings that go
 * to a stranger under the customer's name are unit-testable, the same boundary
 * `lib/jobs/send-core.ts` keeps for the send guard.
 */

export type ProspectMergeSource = {
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  company: { name: string } | null;
};

/**
 * Renders a step template.
 *
 * Only fields we actually hold are substituted, and an unknown placeholder is
 * emptied rather than left as `{{first_name}}` in a stranger's inbox. There is
 * no expression language here on purpose: a template is a string with holes,
 * not a program.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => {
    const name = key.toLowerCase();
    // Own properties only. A plain object inherits from Object.prototype, so
    // `{{constructor}}` would otherwise resolve up the chain and render
    // "function Object() { [native code] }" into a stranger's inbox.
    return Object.hasOwn(values, name) ? values[name] : "";
  });
}

/**
 * Merge fields available to a cold outreach step.
 *
 * Every field has a fallback that still reads as a sentence. A greeting that
 * renders as "Hi ," is worse than a generic one.
 */
export function mergeValuesFor(
  prospect: ProspectMergeSource,
  businessName: string,
): Record<string, string> {
  return {
    first_name: prospect.first_name?.trim() || "there",
    last_name: prospect.last_name?.trim() || "",
    full_name:
      [prospect.first_name, prospect.last_name]
        .filter(Boolean)
        .map((part) => part?.trim())
        .join(" ")
        .trim() || "there",
    role: prospect.role_title?.trim() || "",
    company_name: prospect.company?.name?.trim() || "your company",
    business_name: businessName,
  };
}
