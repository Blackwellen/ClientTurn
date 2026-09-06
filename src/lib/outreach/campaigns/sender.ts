import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sender and domain health, as the campaign wizard and the dispatcher both
 * need to see it (V4 section 17.3, section 18.28).
 *
 * Read from the daily health snapshots rather than recomputed per request: a
 * page that checked every mailbox synchronously would make step 4 as slow as
 * the slowest provider, and the answer would still be a day old.
 *
 * Nothing here returns a credential, a DNS record value, or a provider token.
 * A customer needs to know that DKIM passes; they do not need the selector.
 */

export type SenderHealthState = "HEALTHY" | "WARNING" | "BLOCKED";

export type SenderHealth = {
  id: string;
  email: string;
  displayName: string;
  domain: string | null;
  status: string;
  coldEnabled: boolean;
  active: boolean;
  hasPostalFooter: boolean;
  dailySendCap: number;
  sentToday: number;
  pausedUntil: string | null;
  spf: string;
  dkim: string;
  dmarc: string;
  bounceRate: number;
  complaintRate: number;
  mailboxHealth: string;
  domainHealth: string;
  /** Cold-outreach verdict. Kept as the bare `state`/`summary` because cold is
   *  where this service started and every existing caller means cold. */
  state: SenderHealthState;
  /** One line the UI shows under the picker. */
  summary: string;
  /** Warm follow-up verdict. Warm does not require cold enablement or a postal
   *  footer, so a perfectly good warm sender is often BLOCKED for cold. */
  warmState: SenderHealthState;
  warmSummary: string;
};

/** Which rule set a health verdict is being asked for. */
export type SenderUse = "COLD" | "WARM";

const UNKNOWN_AUTH = "UNKNOWN";

/**
 * Collapses the individual signals into the three states the UI shows.
 *
 * BLOCKED is reserved for conditions that must stop a launch. WARNING means
 * "you should look at this" and never gates anything, which keeps the promise
 * that a disabled Launch button always has a blocking reason behind it.
 */
type HealthInputs = Omit<
  SenderHealth,
  "state" | "summary" | "warmState" | "warmSummary"
>;

export function healthState(
  sender: HealthInputs,
  use: SenderUse = "COLD",
): { state: SenderHealthState; summary: string } {
  if (!sender.active) return { state: "BLOCKED", summary: "This sending identity is switched off." };
  if (sender.status !== "VERIFIED") {
    return { state: "BLOCKED", summary: "Not verified yet. Test the mailbox connection." };
  }
  // Cold-only gates. Warm follow-up goes to people who already contacted this
  // business, so neither cold enablement nor a postal footer is required — and
  // demanding them would wrongly block a healthy mailbox.
  if (use === "COLD") {
    if (!sender.coldEnabled) {
      return { state: "BLOCKED", summary: "Not enabled for cold outreach." };
    }
    if (!sender.hasPostalFooter) {
      return {
        state: "BLOCKED",
        summary: "Cold email needs a postal address on this identity.",
      };
    }
  }
  if (sender.pausedUntil && Date.parse(sender.pausedUntil) > Date.now()) {
    return { state: "BLOCKED", summary: "Sending from this identity is paused." };
  }
  if (sender.mailboxHealth === "PAUSED" || sender.domainHealth === "PAUSED") {
    return { state: "BLOCKED", summary: "Sending is paused for this domain." };
  }
  if (sender.bounceRate > 0.05) {
    return { state: "BLOCKED", summary: "Bounce rate is above the safe threshold." };
  }
  if (sender.complaintRate > 0.003) {
    return { state: "BLOCKED", summary: "Complaint rate is above the safe threshold." };
  }

  const auth = [sender.spf, sender.dkim, sender.dmarc];
  if (auth.some((value) => value === "FAIL")) {
    return { state: "BLOCKED", summary: "SPF, DKIM or DMARC is failing for this domain." };
  }
  if (auth.some((value) => value === "MISSING" || value === UNKNOWN_AUTH)) {
    return {
      state: "WARNING",
      summary: "Email authentication is incomplete. Deliverability may suffer.",
    };
  }
  if (sender.mailboxHealth === "WARNING" || sender.domainHealth === "WARNING") {
    return { state: "WARNING", summary: "Mailbox reputation needs watching." };
  }

  return { state: "HEALTHY", summary: "SPF, DKIM and DMARC are configured. Good sender reputation." };
}

/** Every sending identity in the workspace, with today's health attached. */
export async function loadSenderHealth(businessId: string): Promise<SenderHealth[]> {
  const admin = createAdminClient();

  const [senders, domains, mailboxes] = await Promise.all([
    admin
      .from("sender_identities")
      .select(
        "id, email, display_name, domain, status, cold_enabled, active, postal_footer, daily_send_cap, sent_today, sent_today_on, paused_until, mailbox_connection_id",
      )
      .eq("business_id", businessId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    admin
      .from("domain_health_snapshots")
      .select(
        "domain, spf_state, dkim_state, dmarc_state, bounce_rate, complaint_rate, health_state, snapshot_date",
      )
      .eq("business_id", businessId)
      .order("snapshot_date", { ascending: false })
      .limit(60),
    admin
      .from("mailbox_health_snapshots")
      .select("mailbox_connection_id, health_state, bounce_count, complaint_count, sent_count, snapshot_date")
      .eq("business_id", businessId)
      .order("snapshot_date", { ascending: false })
      .limit(60),
  ]);

  // Snapshots arrive newest-first, so the first row per key is today's.
  // NonNullable<...>[number], not a conditional: `typeof x extends U[] ? T : never`
  // is resolved against the *declared* type rather than distributing over it,
  // so it collapsed to `never` and every read below was an error.
  const domainByName = new Map<string, NonNullable<typeof domains.data>[number]>();
  for (const row of domains.data ?? []) {
    if (!domainByName.has(row.domain)) domainByName.set(row.domain, row);
  }

  const mailboxById = new Map<string, NonNullable<typeof mailboxes.data>[number]>();
  for (const row of mailboxes.data ?? []) {
    if (!mailboxById.has(row.mailbox_connection_id)) {
      mailboxById.set(row.mailbox_connection_id, row);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (senders.data ?? []).map((row) => {
    const domain = row.domain ?? row.email.split("@")[1] ?? null;
    const domainSnapshot = domain ? domainByName.get(domain) : undefined;
    const mailboxSnapshot = row.mailbox_connection_id
      ? mailboxById.get(row.mailbox_connection_id)
      : undefined;

    const sentCount = Number(mailboxSnapshot?.sent_count ?? 0);
    const base = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      domain,
      status: row.status,
      coldEnabled: row.cold_enabled,
      active: row.active,
      hasPostalFooter: Boolean(row.postal_footer),
      dailySendCap: row.daily_send_cap,
      // The counter is only meaningful for today; a stale date means zero sent.
      sentToday: row.sent_today_on === today ? row.sent_today : 0,
      pausedUntil: row.paused_until,
      spf: domainSnapshot?.spf_state ?? UNKNOWN_AUTH,
      dkim: domainSnapshot?.dkim_state ?? UNKNOWN_AUTH,
      dmarc: domainSnapshot?.dmarc_state ?? UNKNOWN_AUTH,
      bounceRate: Number(
        domainSnapshot?.bounce_rate ??
          (sentCount > 0 ? Number(mailboxSnapshot?.bounce_count ?? 0) / sentCount : 0),
      ),
      complaintRate: Number(
        domainSnapshot?.complaint_rate ??
          (sentCount > 0 ? Number(mailboxSnapshot?.complaint_count ?? 0) / sentCount : 0),
      ),
      mailboxHealth: mailboxSnapshot?.health_state ?? "HEALTHY",
      domainHealth: domainSnapshot?.health_state ?? "HEALTHY",
    };

    const warm = healthState(base, "WARM");
    return {
      ...base,
      ...healthState(base, "COLD"),
      warmState: warm.state,
      warmSummary: warm.summary,
    };
  });
}

export async function loadSender(
  businessId: string,
  senderId: string,
): Promise<SenderHealth | null> {
  const all = await loadSenderHealth(businessId);
  return all.find((sender) => sender.id === senderId) ?? null;
}
