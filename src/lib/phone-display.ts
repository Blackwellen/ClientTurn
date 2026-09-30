/**
 * A stored E.164 number, grouped for reading: "+447700900314" shows as
 * "+44 7700 900314". Display only: links and sends keep the raw value.
 *
 * UK numbers use the usual 4-3-3 / 4-6 grouping. Anything else, or anything
 * that is not clean E.164, is returned unchanged rather than guessed at.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const raw = value.trim();
  const uk = /^\+44(\d{10})$/.exec(raw);
  if (uk) {
    const digits = uk[1];
    // Mobiles (07...) and 0800-style numbers read as 4 + 6; London (020) as
    // 2 + 4 + 4; everything else as 4 + 6.
    if (digits.startsWith("20")) {
      return `+44 ${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
    }
    return `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`;
  }
  return raw;
}
