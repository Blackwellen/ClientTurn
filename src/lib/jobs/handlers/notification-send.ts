import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { loadBusinessContext, type BusinessContext } from "./shared";
import { parsePayload } from "./parse";
import { notificationSendPayload } from "./payloads";

type Payload = ReturnType<typeof notificationSendPayload.parse>;

type Resolved = {
  type: NonNullable<Payload["type"]>;
  title: string;
  body: string | null;
  linkUrl: string | null;
};

const KINDS: Record<string, Resolved> = {
  onboarding_resend: {
    type: "billing",
    title: "Finish setting up your Client Turn workspace",
    body: "Your workspace is ready. Complete setup to start following up on new leads.",
    linkUrl: "/onboarding",
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

async function sendEmail(to: string, subject: string, text: string) {
  const key = serverEnv.resend.apiKey;
  if (!key) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: serverEnv.resend.from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!response.ok && response.status >= 500) {
    throw new Error(`Resend responded with ${response.status}.`);
  }
}

export async function handleNotificationSend(job: ClaimedJob) {
  const payload = parsePayload(notificationSendPayload, job.payload);
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

  for (const person of people) {
    if (!person.email) continue;
    await sendEmail(person.email, resolved.title, text);
  }
}
