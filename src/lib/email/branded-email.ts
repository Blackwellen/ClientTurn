/**
 * The branded HTML shell for system email, in the ClientTurn palette
 * (midnight #0B1020, lime #B7F34A, cloud #F7F9FC; CLAUDE.md).
 *
 * Table layout and inline styles only: email clients strip <style> tags and
 * ignore flexbox/grid. Pure (the site URL is passed in) so a template can be
 * rendered in a unit test. Callers escape their own text; `escapeHtml` is here
 * for that.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BrandedSection = { heading: string; paragraphs: string[]; bullets?: string[] };

export function brandedEmailHtml(input: {
  siteUrl: string;
  heading: string;
  paragraphs: string[];
  sections?: BrandedSection[];
  ctaLabel: string;
  ctaUrl: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
}): string {
  const p = (text: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B1020;">${text}</p>`;

  const sections = (input.sections ?? [])
    .map((section) => {
      const bullets = section.bullets?.length
        ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#0B1020;">${section.bullets
            .map((b) => `<li style="margin:0 0 6px;">${b}</li>`)
            .join("")}</ul>`
        : "";
      return `<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;color:#0B1020;">${section.heading}</h2>${section.paragraphs
        .map(p)
        .join("")}${bullets}`;
    })
    .join("");

  const secondary = input.secondaryUrl
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5b6472;">
         <a href="${input.secondaryUrl}" style="color:#5b6472;">${input.secondaryLabel ?? input.secondaryUrl}</a>
       </p>`
    : "";

  return `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background-color:#F7F9FC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F9FC;padding:32px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background-color:#0B1020;padding:24px 32px;">
                <img src="${input.siteUrl}/white_background_logo.png" alt="Client Turn" height="28" style="display:block;height:28px;width:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0B1020;">${input.heading}</h1>
                ${input.paragraphs.map(p).join("")}
                ${sections}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                  <tr>
                    <td style="border-radius:8px;background-color:#B7F34A;">
                      <a href="${input.ctaUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#0B1020;text-decoration:none;">${input.ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                ${secondary}
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#9aa3b2;">Client Turn · ${input.siteUrl.replace(/^https?:\/\//, "")}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
