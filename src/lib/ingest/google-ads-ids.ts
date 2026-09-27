/**
 * One identity for a Google Ads lead-form submission, whichever path saw it.
 *
 * The lead-form webhook sends a bare `lead_id`; the search API returns
 * `customers/{cid}/leadFormSubmissionData/{id}`. Both paths record the
 * trailing id, so a submission delivered by the webhook and then found again
 * by the poller is one touch, not two.
 *
 * Pure: no server-only import, so it can be tested directly.
 */
export function submissionIdFromResourceName(resourceName: string): string {
  const trimmed = resourceName.trim();
  const last = trimmed.split("/").filter(Boolean).pop();
  return last && last.length > 0 ? last : trimmed;
}
