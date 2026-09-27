/**
 * The wording shown with, and recorded against, a ClientTurn e-signature.
 *
 * Legal position (for the docs and help centre; owner/lawyer to review):
 * this is a SIMPLE ELECTRONIC SIGNATURE with an audit trail. Section 7 of
 * the Electronic Communications Act 2000 makes an electronic signature
 * admissible in evidence, and UK eIDAS (retained Regulation 910/2014, Art.
 * 25) says it may not be denied legal effect only because it is
 * electronic. That is sufficient for most B2B commercial contracts in
 * England & Wales. It is deliberately NOT described as any higher tier of
 * e-signature: it involves no certificate from a trust service provider.
 * Some documents (deeds, lasting powers of attorney, certain guarantees
 * and land transactions) have their own formalities, so the notice says so.
 *
 * The consent text is versioned; the version and a hash of the exact text
 * shown are sealed into every signature record (seal.ts).
 */

export const SIGNATURE_TYPE = "SIMPLE_ELECTRONIC_SIGNATURE" as const;

export const SIGNATURE_TYPE_LABEL = "Simple electronic signature with audit trail";

export const CONSENT_TEXT_VERSION = "consent/1";

export const CONSENT_TEXT =
  "I agree to sign this quote electronically, and I confirm that I am authorised to accept it on behalf of the business named as the buyer.";

export const SIGNATURE_NOTICE =
  "This is a simple electronic signature. When you sign, we record your typed and/or drawn signature, your name and email address, " +
  "your IP address and browser, the time, and a SHA-256 fingerprint of this exact version of the quote, so any later change to the quote can be detected. " +
  "Electronic signatures are admissible under the Electronic Communications Act 2000 and UK eIDAS, and are used for most business contracts in England and Wales. " +
  "Some documents, such as deeds, need a different form of signature.";
