/**
 * Public-facing company identity. Registered details are intentionally blank:
 * the footer and legal pages render them only once the operator supplies real
 * values, so the site can never publish an invented registration or address.
 */
export const COMPANY = {
  product: "ClientTurn",
  supportEmail: "support@clientturn.co.uk",
  privacyEmail: "privacy@clientturn.co.uk",
  salesEmail: "sales@clientturn.co.uk",
  registeredName: "",
  companyNumber: "",
  registeredAddress: "",
  icoRegistration: "",
} as const;

export const LEGAL_LAST_UPDATED = "5 September 2026";

export function hasRegisteredDetails() {
  return Boolean(COMPANY.registeredName && COMPANY.registeredAddress);
}
