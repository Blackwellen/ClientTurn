import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { loadBusinessContext, type BusinessContext } from "./shared";
import { parsePayload } from "./parse";
import { notificationSendPayload } from "./payloads";
import { getEntitlements } from "@/lib/billing/entitlements";
import { consumeSystemEmail } from "@/lib/email/system-email-budget";
import { SUBSCRIPTION_WELCOME_KIND, subscriptionWelcomeEmail } from "@/lib/email/subscription-welcome";
import { MAINTENANCE_NOTICE_KIND } from "@/lib/maintenance/email";
import { sendMaintenanceNotice } from "@/lib/maintenance/notice-send";

type Payload = ReturnType<typeof notificationSendPayload.parse>;

type Resolved = {
  type: NonNullable<Payload["type"]>;
  title: string;
  body: string | null;
  linkUrl: string | null;
  /** Overrides `serverEnv.resend.from` for this kind only. */
  from?: string;
  /**
   * Renders a branded HTML alternative for this kind, given the absolute
   * link the plain-text body also carries. Kinds without one send as
   * plain text, same as before.
   */
  html?: (link: string) => string;
};

const ZAPIER_INVITE_URL =
  "https://zapier.com/developer/public-invite/246145/e2dca89db7e75b1920ba68ac73c4dbfb/";

/**
 * A minimal, table-based HTML shell in the ClientTurn palette (midnight
 * #0B1020, lime #B7F34A, cloud #F7F9FC — see CLAUDE.md).
 *
 * Table layout and inline styles only: email clients strip <style> tags and
 * ignore flexbox/grid, so anything else renders inconsistently across
 * Outlook, Gmail and Apple Mail.
 */
function brandedEmailHtml(input: {
  heading: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
}) {
  const paragraphHtml = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B1020;">${p}</p>`,
    )
    .join("");

  const secondary = input.secondaryUrl
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5b6472;">
         <a href="${input.secondaryUrl}" style="color:#5b6472;">${input.secondaryLabel}</a>
       </p>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#F7F9FC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F9FC;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background-color:#0B1020;padding:24px 32px;">
                <img src="${serverEnv.siteUrl}/white_background_logo.png" alt="Client Turn" height="28" style="display:block;height:28px;width:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0B1020;">${input.heading}</h1>
                ${paragraphHtml}
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
          <p style="margin:24px 0 0;font-size:12px;color:#9aa3b2;">Client Turn · ${serverEnv.siteUrl.replace(/^https?:\/\//, "")}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const KINDS: Record<string, Resolved> = {
  onboarding_resend: {
    type: "billing",
    title: "Finish setting up your Client Turn workspace",
    body: "Your workspace is ready. Complete setup to start following up on new leads.",
    linkUrl: "/onboarding",
  },
  developer_integrations_invite: {
    type: "billing",
    title: "Connect Client Turn to 6,000+ apps with Zapier",
    body:
      "Now that you're up and running, you can wire Client Turn into the rest of your " +
      "stack — post new leads to Slack, log them to a spreadsheet, or look up and update " +
      "a lead from any other app.\n\n" +
      `Connect Client Turn on Zapier: ${ZAPIER_INVITE_URL}`,
    linkUrl: "/app/settings/connections",
    from: "Client Turn <admin@clientturn.com>",
    html: () =>
      brandedEmailHtml({
        heading: "Connect Client Turn to 6,000+ apps",
        paragraphs: [
          "Now that you're up and running, you can wire Client Turn into the rest of your stack — post new leads to Slack, log them to a spreadsheet, or look up and update a lead from any other app.",
        ],
        ctaLabel: "Connect on Zapier",
        ctaUrl: ZAPIER_INVITE_URL,
        secondaryLabel: "Or manage your connections in Client Turn",
        secondaryUrl: `${serverEnv.siteUrl}/app/settings/connections`,
      }),
  },
};

function resolve(payload: Payload): Resolved | null {
  if (payload.kind) {
    const preset = KINDS[payload.kind];
    if (!preset) return null;
    return {
      ...preset,
      title: payload.title ?? preset.title,
      body: payload.body ?? preset.body,
      linkUrl: payload.linkUrl ?? preset.linkUrl,
    };
  }

  if (!payload.type || !payload.title) return null;

  return {
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    linkUrl: payload.linkUrl ?? null,
  };
}

/** Workspace-level toggles decide whether an email leaves the building. */
function emailAllowed(business: BusinessContext, type: Resolved["type"]) {
  if (type === "handover" || type === "lead_attention") {
    return business.notify.handover;
  }
  if (type === "booking") return business.notify.booking;
  if (type === "integration_failure") return business.notify.integrationFailure;
  if (type === "campaign_complete") return business.notify.campaignComplete;
  return true;
}

async function recipients(businessId: string, userId: string | null) {
  const admin = createAdminClient();

  if (userId) {
    const { data } = await admin
      .from("profiles")
      .select("id, email, first_name")
      .eq("id", userId)
      .maybeSingle();
    return data ? [data] : [];
  }

  const { data: members } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);

  const ids = (members ?? []).map((row) => row.user_id);
  if (ids.length === 0) return [];

  const { data } = await admin
    .from("profiles")
    .select("id, email, first_name")
    .in("id", ids);

  return data ?? [];
}

async function sendEmail(
  to: string,
  subject: string,
  text: string,
  from?: string,
  html?: string,
) {
  const key = serverEnv.resend.apiKey;
  if (!key) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from ?? serverEnv.resend.from,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  if (!response.ok) {
    if (response.status >= 500) {
      throw new Error(`Resend responded with ${response.status}.`);
    }
    const detail = await response.text().catch(() => "");
    console.error(
      `[notification-send] Resend rejected a send with ${response.status}: ${detail.slice(0, 500)}`,
    );
  }
}

/**
 * The one-off subscription welcome email (docs/upsell-plan.md): to the owner
 * only, built from the plan as it is NOW (re-read, not trusted from the
 * payload), counted against the daily system email cap like every other
 * notification copy. Queued once per Stripe subscription by
 * subscription-sync `queueSubscriptionWelcome`.
 */
async function sendSubscriptionWelcome(payload: Payload) {
  const entitlements = await getEntitlements(payload.businessId);
  // Cancelled, or back in a trial, since it was queued: nothing to welcome.
  if (entitlements.state !== "ACTIVE" || entitlements.plan === "trial") return;

  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", payload.businessId)
    .eq("status", "active")
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (!owner?.user_id) return;
  const [person] = await recipients(payload.businessId, owner.user_id);
  if (!person) return;

  const email = subscriptionWelcomeEmail({
    plan: entitlements.plan,
    siteUrl: serverEnv.siteUrl,
    firstName: person.first_name ?? null,
  });

  const { error } = await admin.from("notifications").insert({
    business_id: payload.businessId,
    user_id: person.id,
    type: "billing",
    severity: "info",
    title: email.subject,
    body: email.summary,
    link_url: "/app/settings?section=billing",
    entity_type: null,
    entity_id: null,
  });
  if (error) throw error;

  if (!person.email) return;
  const budget = await consumeSystemEmail({ businessId: payload.businessId, plan: entitlements.plan });
  if (!budget.allowed) {
    console.warn("[notification-send] daily system-email cap reached; welcome email skipped", {
      businessId: payload.businessId,
      cap: budget.cap,
    });
    return;
  }
  await sendEmail(person.email, email.subject, email.text, undefined, email.html);
}

export async function handleNotificationSend(job: ClaimedJob) {
  const payload = parsePayload(notificationSendPayload, job.payload);
  if (payload.kind === SUBSCRIPTION_WELCOME_KIND) {
    await sendSubscriptionWelcome(payload);
    return;
  }
  // Planned-maintenance notice (0161): owners only, re-reads the window.
  if (payload.kind === MAINTENANCE_NOTICE_KIND) {
    await sendMaintenanceNotice(payload, sendEmail);
    return;
  }
  const resolved = resolve(payload);

  if (!resolved) {
    throw new PermanentJobError(
      "Notification payload has neither a known kind nor a type and title.",
    );
  }

  const business = await loadBusinessContext(payload.businessId);
  if (!business) {
    throw new PermanentJobError(`Business ${payload.businessId} is gone.`);
  }

  const admin = createAdminClient();
  const people = await recipients(payload.businessId, payload.userId ?? null);
  if (people.length === 0) return;

  const rows = people.map((person) => ({
    business_id: payload.businessId,
    user_id: person.id,
    type: resolved.type,
    severity: payload.severity,
    title: resolved.title,
    body: resolved.body,
    link_url: resolved.linkUrl,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
  }));

  const { error } = await admin.from("notifications").insert(rows);
  if (error) throw error;

  if (!emailAllowed(business, resolved.type)) return;

  const link = resolved.linkUrl
    ? `${serverEnv.siteUrl}${resolved.linkUrl}`
    : serverEnv.siteUrl;
  const text = `${resolved.body ?? resolved.title}\n\n${link}`;
  const html = resolved.html?.(link);

  // System email goes through Resend, which we pay for: a daily cap per
  // workspace bounds it (economics.md §9). At the cap the in-app rows above
  // stand and only the email copy is skipped. An unreadable plan counts as a
  // trial, the smallest cap.
  const plan = await getEntitlements(payload.businessId)
    .then((entitlements) => entitlements.plan)
    .catch(() => "trial");
  for (const person of people) {
    if (!person.email) continue;
    const budget = await consumeSystemEmail({ businessId: payload.businessId, plan });
    if (!budget.allowed) {
      console.warn("[notification-send] daily system-email cap reached; email copy skipped", {
        businessId: payload.businessId,
        cap: budget.cap,
      });
      break;
    }
    await sendEmail(person.email, resolved.title, text, resolved.from, html);
  }
}
