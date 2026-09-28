/**
 * The help-centre shot list for scripts/capture-help-screenshots.mjs.
 *
 * Each shot: `id`, `article` (slug), `file` (<category>/<slug>-<n>.png),
 * `row` (the file name in content/help/SCREENSHOTS.md, to mark it Done),
 * `url`, optional `prepare(page)`, `region(page)` (locator(s) whose union is
 * the crop), `markers(page)` (numbered in order; `box: false` for a marker
 * without a frame), `caption`, `alt`, and `simulated: true` when the shot
 * needs the simulated connections.
 */

/** The nearest bordered card around a piece of text. */
export function card(page, text, { exact = true } = {}) {
  return page
    .getByText(text, { exact })
    .first()
    .locator("xpath=ancestor::*[contains(@class,'rounded') and (contains(@class,'border') or contains(@class,'ring-') or contains(@class,'shadow'))][1]");
}

/** The nearest bordered card around a locator. */
export function cardOf(locator) {
  return locator.locator("xpath=ancestor::*[contains(@class,'rounded') and (contains(@class,'border') or contains(@class,'ring-') or contains(@class,'shadow'))][1]");
}

export const button = (page, name, exact = true) => page.getByRole("button", { name, exact }).first();
export const text = (page, value, exact = true) => page.getByText(value, { exact }).first();

export const SHOTS = [];

/** A Find Leads social queue section, by its heading. */
const queue = (p, title) => p.locator("section").filter({ has: p.getByRole("heading", { name: title }) }).last();

const SESSION_TITLE = "SaaS and ecommerce in Manchester, 10 to 50 staff";

/** Opens the demo search session from the Find Leads page by its title. */
async function openSession(page) {
  const href = await page.evaluate((title) => {
    const links = [...document.querySelectorAll("a[href*='/app/find-leads/search/']")];
    return links.find((a) => a.textContent?.includes(title))?.getAttribute("href") ?? null;
  }, SESSION_TITLE);
  if (!href) throw new Error("demo search session link not found on Find Leads");
  await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}

const HOOK = "https://hooks.blackwellen-demo.example/clientturn";
const MCP_NAME = "Claude (Alex's laptop)";

SHOTS.push(
  /* ------------------------------------------------ developers */
  {
    id: "api-overview",
    article: "api-overview-and-authentication",
    file: "developers/api-overview-and-authentication-1.png",
    row: "api-overview-and-authentication-developer.png",
    url: "/app/settings?section=developer",
    region: (p) => card(p, "Build on ClientTurn"),
    markers: (p) => [{ locator: cardOf(text(p, "Base URL")) }, { locator: cardOf(text(p, "MCP endpoint")) }],
    caption: "Your base URL and MCP endpoint",
    alt: "The Build on ClientTurn panel showing the API base URL, the MCP endpoint and example requests",
  },
  {
    id: "webhooks-log",
    article: "webhooks",
    file: "developers/webhooks-1.png",
    row: "webhooks-delivery-log.png",
    url: "/app/settings?section=developer",
    region: (p) => card(p, "Webhooks"),
    markers: (p) => [
      { locator: text(p, "Recent deliveries"), box: false },
      { locator: text(p, "Retrying") },
      { locator: text(p, "Delivered") },
      { locator: text(p, "Gave up") },
    ],
    caption: "What was sent and what your server answered",
    alt: "The Webhooks panel with one endpoint and its recent deliveries marked Retrying, Delivered and Gave up",
  },
  {
    id: "webhook-row-controls",
    article: "setting-up-a-webhook",
    file: "developers/setting-up-a-webhook-2.png",
    row: "setting-up-a-webhook-row-controls.png",
    url: "/app/settings?section=developer",
    region: (p) => cardOf(text(p, HOOK)),
    markers: (p) => {
      const row = cardOf(text(p, HOOK));
      return [0, 1, 2, 3, 4].map((i) => ({ locator: row.getByRole("button").nth(i) }));
    },
    caption: "Endpoint controls: test, edit, pause, rotate the secret, delete",
    alt: "An active webhook endpoint row with its Test, Edit, pause, rotate secret and delete controls",
  },
  {
    id: "mcp-connection-row",
    article: "connect-an-ai-assistant",
    file: "developers/connect-an-ai-assistant-2.png",
    row: "connect-an-ai-assistant-row.png",
    url: "/app/settings?section=developer",
    region: (p) => cardOf(p.getByText(MCP_NAME, { exact: true }).last()),
    markers: (p) => {
      const row = cardOf(p.getByText(MCP_NAME, { exact: true }).last());
      return [{ locator: row.getByText("Read your business profile and status").first() }, { locator: row.getByRole("button", { name: /Replace key|Issue key/ }) }];
    },
    caption: "Replace a lost key without recreating the connection",
    alt: "An assistant connection row with its permissions and the Replace key button",
  },
  {
    id: "mcp-pending",
    article: "mcp-tools-and-approvals",
    file: "developers/mcp-tools-and-approvals-1.png",
    row: "mcp-tools-and-approvals-pending.png",
    url: "/app/settings?section=developer",
    region: (p) => card(p, "Assistant connections"),
    markers: (p) => [{ locator: cardOf(text(p, "Waiting for your decision")) }, { locator: button(p, "Approve") }, { locator: button(p, "Refuse") }],
    caption: "Nothing happens until someone approves",
    alt: "Assistant connections with a request to start an agent waiting for a decision, and Approve and Refuse buttons",
  },
  {
    id: "developer-overview",
    article: "developer-settings",
    file: "settings/developer-settings-1.png",
    row: "developer-settings-overview.png",
    url: "/app/settings?section=developer",
    region: (p) => [card(p, "API keys"), card(p, "Assistant connections")],
    markers: (p) => [{ locator: text(p, "API keys"), box: false }, { locator: text(p, "Webhooks"), box: false }, { locator: text(p, "Assistant connections"), box: false }],
    caption: "Every credential with access to your workspace, in one place",
    alt: "The Developer section with one API key, one webhook endpoint and one assistant connection",
  },

  /* ------------------------------------------------ settings */
  {
    id: "team-members",
    article: "team-settings",
    file: "settings/team-settings-1.png",
    row: "team-settings-members.png",
    url: "/app/settings?section=team",
    region: (p) => card(p, "Team members"),
    markers: (p) => [
      { locator: button(p, "Invite member") },
      { locator: p.locator("tr", { hasText: "Priya Nandra" }).getByRole("combobox").first() },
      { locator: text(p, "Invite expired", false) },
      { locator: p.locator("tr", { hasText: "Tom Ashby" }).getByRole("button").last() },
    ],
    caption: "Invite people, set roles and manage invitations",
    alt: "The Team members table with an owner, an admin, a member and an expired invitation",
  },
  {
    id: "business-facts",
    article: "business-profile-settings",
    file: "settings/business-profile-settings-1.png",
    row: "business-profile-settings-facts.png",
    url: "/app/settings?section=business-profile",
    region: (p) => [card(p, "What we know about your business"), card(p, "Business facts")],
    markers: (p) => [
      { locator: button(p, "Analyse") },
      { locator: card(p, "Business facts").getByText("From your website", { exact: true }).first() },
      { locator: p.getByText("Sales · typical cycle days", { exact: false }).first().locator("xpath=ancestor::div[.//button][1]") },
    ],
    caption: "Confirm facts ClientTurn found so the assistant can use them",
    alt: "Business facts read from the website with source badges, and an inferred fact marked Worth checking",
  },

  /* ------------------------------------------------ find leads and agents */
  {
    id: "find-leads-plan",
    article: "find-leads-discovery",
    file: "finding-leads/find-leads-discovery-4.png",
    row: "find-leads-discovery-plan.png",
    url: "/app/find-leads?view=discover",
    prepare: openSession,
    region: (p) => [card(p, "Structured search plan"), card(p, "Sourcing controls")],
    markers: (p) => [{ locator: card(p, "Structured search plan") }, { locator: card(p, "Sourcing controls") }, { locator: button(p, "Start sourcing run") }],
    caption: "Check the plan, then start the run; nothing is spent until you do",
    alt: "A structured search plan for SaaS and ecommerce companies in Manchester with 10 to 50 staff, and the Sourcing controls with Start sourcing run",
  },
  {
    id: "linkedin-queue",
    article: "linkedin-sales-navigator-assisted",
    file: "finding-leads/linkedin-sales-navigator-assisted-2.png",
    row: "linkedin-sales-navigator-assisted-queue.png",
    url: "/app/find-leads?view=social",
    region: (p) => [queue(p, "Ready to message"), queue(p, "Waiting on them")],
    markers: (p) => [
      { locator: queue(p, "Ready to message") },
      { locator: queue(p, "Ready to invite") },
      { locator: queue(p, "Waiting on them") },
      { locator: queue(p, "Ready to invite").getByText("Open", { exact: true }).first() },
    ],
    caption: "You send in LinkedIn, then record it here",
    alt: "The LinkedIn queue with Ready to message, Ready to invite and Waiting on them lists",
  },
  {
    id: "linkedin-inmail",
    article: "linkedin-sales-navigator-assisted",
    file: "finding-leads/linkedin-sales-navigator-assisted-4.png",
    row: "linkedin-sales-navigator-assisted-inmail.png",
    url: "/app/find-leads?view=social",
    region: (p) => card(p, "LinkedIn InMail credits"),
    markers: (p) => [{ locator: text(p, "Credits left") }, { locator: button(p, "Reply received") }],
    caption: "The credit balance is worked out from what you record",
    alt: "The LinkedIn InMail credits panel with credits left, InMails awaiting a reply and Reply received buttons",
  },
  {
    id: "agent-plan",
    article: "finding-and-sourcing-leads",
    file: "finding-leads/finding-and-sourcing-leads-1.png",
    row: "finding-and-sourcing-leads-agent-plan.png",
    url: "/app/agents/new",
    prepare: async (p) => {
      await button(p, "Continue").click();
      await p.waitForTimeout(800);
      const select = p.locator("select").filter({ has: p.locator("option", { hasText: "No plan yet" }) });
      const options = await select.locator("option").allTextContents();
      const pick = options.find((o) => o.includes("Manchester")) ?? options[1];
      await select.selectOption({ label: pick });
      await p.waitForTimeout(500);
    },
    region: (p) => card(p, "Where should it look?"),
    markers: (p) => [{ locator: p.getByText("Approved search plan", { exact: true }).first().locator("xpath=following::button[1]") }],
    caption: "A sourcing agent reuses a plan you approved",
    alt: "Step 2 of creating an agent, with the sources to use and the approved Manchester search plan selected",
  },
  {
    id: "agent-activity",
    article: "agents-run-24-7",
    file: "ai-agents/agents-run-24-7-2.png",
    row: "agents-run-24-7-activity.png",
    url: "/app/agents",
    prepare: async (p) => {
      await p.getByText("Manchester SaaS sourcing", { exact: true }).first().click();
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(800);
      await p.getByText("Activity", { exact: true }).first().click();
      await p.waitForTimeout(900);
    },
    region: (p) => card(p, "Activity history"),
    markers: (p) => [{ locator: card(p, "Activity history").getByText(/, 0[1-3]:\d\d/).first() }],
    caption: "Runs continue with nobody logged in",
    alt: "The agent's activity history showing a scheduled sourcing run queued at about 2am each night",
  },
);

/* ------------------------------------------------ simulated connections */

const CONNECTIONS = "/app/settings?section=connections";
const WORKSPACE = "/app/settings?section=workspace";
const providerCard = (p, name) => card(p, name);
const crmGroup = (p) => p.getByText(/of 3 connected/).first().locator("xpath=..");
const toast = (p) => cardOf(p.locator("p").filter({ hasText: /^Meta Lead Ads connected$/ }).first());
const drawer = (p) => p.getByRole("dialog").first();

async function manage(p, name) {
  const c = providerCard(p, name);
  await c.scrollIntoViewIfNeeded();
  await c.getByRole("button", { name: "Manage", exact: true }).click();
  await drawer(p).waitFor({ state: "visible" });
  await p.waitForTimeout(700);
}

/** The select that follows a section label inside the drawer. */
const selectAfter = (p, label) => drawer(p).getByText(label, { exact: true }).first().locator("xpath=following::select[1]");

async function setLinkedIn(ctx, status) {
  const { data } = await ctx.admin.from("integrations").select("id").eq("business_id", ctx.businessId).eq("provider_type", "linkedin_ads").single();
  await ctx.admin
    .from("integrations")
    .update(
      status === "ACTION_REQUIRED"
        ? { status, last_error_at: ctx.ago(0, 2), last_error_code: "HTTP_403", last_error_message: "LinkedIn refused access to lead forms (403): this app is not yet approved for the Lead Sync API." }
        : { status: "HEALTHY", last_error_at: null, last_error_code: null, last_error_message: null },
    )
    .eq("id", data.id);
}

async function chooseBooking(p, label) {
  const c = card(p, "How qualified leads book");
  await c.scrollIntoViewIfNeeded();
  await c.getByText(label, { exact: true }).first().click();
  // Typed, never saved: an example scheduling link for the image.
  if (label === "Calendly") await p.locator("#booking-url").fill("https://calendly.com/blackwellen-demo/discovery-call");
  await p.waitForTimeout(600);
}

SHOTS.push(
  {
    id: "meta-card",
    simulated: true,
    article: "meta-lead-ads",
    file: "finding-leads/meta-lead-ads-1.png",
    row: "meta-lead-ads-card-connected.png",
    url: CONNECTIONS,
    region: (p) => providerCard(p, "Meta Lead Ads"),
    markers: (p) => [{ locator: providerCard(p, "Meta Lead Ads").getByText("Connected", { exact: true }) }, { locator: cardOf(providerCard(p, "Meta Lead Ads").getByText("Last successful sync")) }],
    caption: "A connected Meta card shows its last successful sync",
    alt: "The Meta Lead Ads card marked Connected, with the business account and the last successful sync",
  },
  {
    id: "google-ads-webhook",
    simulated: true,
    article: "google-ads-lead-forms",
    file: "finding-leads/google-ads-lead-forms-1.png",
    row: "google-ads-lead-forms-webhook.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "Google Ads"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [
      { locator: drawer(p).locator("code").nth(0) },
      { locator: drawer(p).locator("code").nth(1) },
      { locator: drawer(p).locator("ol").first() },
    ],
    caption: "Copy the webhook URL and key into each lead form",
    alt: "The Google Ads connection panel with the instant delivery webhook URL, the hidden key and the four set-up steps",
  },
  {
    id: "google-ads-account",
    simulated: true,
    article: "connecting-google-ads",
    file: "integrations/connecting-google-ads-1.png",
    row: "connecting-google-ads-drawer.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "Google Ads"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [{ locator: drawer(p).getByRole("combobox").first() }, { locator: drawer(p).getByRole("button", { name: "Use this account" }) }],
    caption: "Choose which Google Ads account leads are read from",
    alt: "The Google Ads panel with the Google Ads account select listing two accounts and the Use this account button",
  },
  {
    id: "linkedin-card",
    simulated: true,
    article: "linkedin-lead-gen-forms",
    file: "finding-leads/linkedin-lead-gen-forms-1.png",
    row: "linkedin-lead-gen-forms-card.png",
    url: CONNECTIONS,
    region: (p) => providerCard(p, "LinkedIn Lead Gen Forms"),
    markers: (p) => [{ locator: providerCard(p, "LinkedIn Lead Gen Forms").getByText(/LinkedIn ad account/).locator("xpath=..") }],
    caption: "Check the card names the Page that runs your lead-gen ads",
    alt: "The LinkedIn Lead Gen Forms card, connected, naming the LinkedIn organisation",
  },
  {
    id: "linkedin-organisation",
    simulated: true,
    article: "connecting-linkedin",
    file: "integrations/connecting-linkedin-1.png",
    row: "connecting-linkedin-organisation.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "LinkedIn Lead Gen Forms"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [{ locator: drawer(p).getByRole("combobox").first() }, { locator: drawer(p).getByRole("button", { name: "Use this organisation" }) }],
    caption: "Choose which Company Page's lead forms are read",
    alt: "The LinkedIn panel with the LinkedIn organisation select and the Use this organisation button",
  },
  {
    id: "meta-page-picker",
    simulated: true,
    article: "connecting-meta",
    file: "integrations/connecting-meta-1.png",
    row: "connecting-meta-page-picker.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "Meta Lead Ads"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [
      { locator: drawer(p).getByText(/access expires in/).first() },
      { locator: drawer(p).getByRole("combobox").first() },
      { locator: drawer(p).getByRole("button", { name: "Use this Page" }) },
    ],
    caption: "Choose the Page, and reconnect before access expires",
    alt: "The Meta panel with the access expiry warning, the Facebook Page select and the Use this Page button",
  },
  {
    id: "crm-pull",
    simulated: true,
    article: "pulling-leads-from-your-crm",
    file: "finding-leads/pulling-leads-from-your-crm-1.png",
    row: "pulling-leads-from-your-crm-toggle.png",
    url: CONNECTIONS,
    region: (p) => card(p, "Import contacts from your CRM"),
    markers: (p) => [{ locator: cardOf(card(p, "Import contacts from your CRM").getByText("HubSpot", { exact: true })).getByRole("switch") }, { locator: card(p, "Import contacts from your CRM").getByText(/imported, \d+ skipped/) }],
    caption: "The last check shows records imported and skipped",
    alt: "The Import contacts from your CRM card with HubSpot switched on and its last check, and Salesforce and Zoho CRM off",
  },
  {
    id: "crm-group",
    simulated: true,
    article: "integrating-with-your-crm",
    file: "integrations/integrating-with-your-crm-1.png",
    row: "integrating-with-your-crm-crm-group.png",
    url: CONNECTIONS,
    region: (p) => cardOf(crmGroup(p)),
    markers: (p) => [{ locator: providerCard(p, "HubSpot") }, { locator: providerCard(p, "Zoho CRM") }, { locator: providerCard(p, "Salesforce") }],
    caption: "Connected CRMs receive qualified and booked leads",
    alt: "The CRM group of Connections with HubSpot, Zoho CRM and Salesforce all connected",
  },
  {
    id: "crm-push-status",
    simulated: true,
    article: "integrating-with-your-crm",
    file: "integrations/integrating-with-your-crm-2.png",
    row: "integrating-with-your-crm-push-status.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "HubSpot"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [{ locator: cardOf(drawer(p).getByText("Last push", { exact: true })) }, { locator: drawer(p).getByText(/was not pushed/) }],
    caption: "See what reached your CRM and what did not",
    alt: "The HubSpot panel's Push status with the last push, the count pushed in the last 30 days and one failed push",
  },
  {
    id: "salesforce-card",
    simulated: true,
    article: "connecting-salesforce",
    file: "integrations/connecting-salesforce-1.png",
    row: "connecting-salesforce-card.png",
    url: CONNECTIONS,
    region: (p) => providerCard(p, "Salesforce"),
    markers: (p) => [{ locator: providerCard(p, "Salesforce").getByText(/Salesforce org/).locator("xpath=..") }],
    caption: "A connected Salesforce org",
    alt: "The Salesforce card marked Connected with the org name and last successful sync",
  },
  {
    id: "zoho-card",
    simulated: true,
    article: "connecting-zoho-crm",
    file: "integrations/connecting-zoho-crm-1.png",
    row: "connecting-zoho-crm-card.png",
    url: CONNECTIONS,
    region: (p) => providerCard(p, "Zoho CRM"),
    markers: (p) => [{ locator: providerCard(p, "Zoho CRM").getByText("Connected", { exact: true }) }],
    caption: "Zoho CRM connected in your data centre",
    alt: "The Zoho CRM card marked Connected with the account name and last successful sync",
  },
  {
    id: "slack-alerts",
    simulated: true,
    article: "connecting-slack",
    file: "integrations/connecting-slack-1.png",
    row: "connecting-slack-alerts.png",
    url: WORKSPACE,
    region: (p) => [card(p, "Slack alerts"), card(p, "What goes to Slack")],
    markers: (p) => [{ locator: card(p, "Slack alerts").locator("input").first() }, { locator: card(p, "What goes to Slack") }],
    caption: "Choose the channel and which alerts it receives",
    alt: "The Slack alerts card with the channel ID, and What goes to Slack with new lead, handover, booking and warm prospect alerts ticked",
  },
  {
    id: "slack-channel",
    simulated: true,
    article: "connecting-slack",
    file: "integrations/connecting-slack-2.png",
    row: "connecting-slack-channel.png",
    url: CONNECTIONS,
    prepare: (p) => manage(p, "Slack"),
    region: (p) => drawer(p),
    pad: 0,
    markers: (p) => [{ locator: drawer(p).getByText(/Posting to/) }, { locator: drawer(p).getByText("Change the channel in Workspace settings") }],
    caption: "Check which channel alerts are posted to",
    alt: "The Slack panel showing the alert channel and the link to change it in Workspace settings",
  },
  {
    id: "calendly-booking-mode",
    simulated: true,
    article: "connecting-calendly",
    file: "integrations/connecting-calendly-1.png",
    row: "connecting-calendly-booking-mode.png",
    url: WORKSPACE,
    prepare: (p) => chooseBooking(p, "Calendly"),
    region: (p) => [card(p, "How qualified leads book"), card(p, "Appointment shape")],
    markers: (p) => [{ locator: p.getByText("Qualified leads receive your Calendly link.", { exact: false }).first().locator("xpath=ancestor::label[1]") }, { locator: p.locator("#calendly-event-type") }, { locator: p.locator("#booking-url") }],
    caption: "Choose the event type the assistant offers times from",
    alt: "How qualified leads book with Calendly selected, the Calendly event type and the booking link",
  },
  {
    id: "calendly-booking-link",
    simulated: true,
    article: "booking-with-calendly",
    file: "booking-and-sales/booking-with-calendly-1.png",
    row: "booking-with-calendly-link.png",
    url: WORKSPACE,
    prepare: (p) => chooseBooking(p, "Calendly"),
    region: (p) => [card(p, "How qualified leads book"), card(p, "Appointment shape")],
    markers: (p) => [{ locator: p.getByText("Qualified leads receive your Calendly link.", { exact: false }).first().locator("xpath=ancestor::label[1]") }, { locator: p.locator("#calendly-event-type") }, { locator: p.locator("#booking-url") }],
    caption: "Choose Calendly, its event type and the link leads should use",
    alt: "The booking card with the Calendly option selected, the Calendly event type and the booking link field",
  },
  {
    id: "google-calendar-appointment",
    simulated: true,
    article: "connecting-google-calendar",
    file: "integrations/connecting-google-calendar-1.png",
    row: "connecting-google-calendar-appointment.png",
    url: WORKSPACE,
    prepare: (p) => chooseBooking(p, "Google Calendar"),
    region: (p) => [card(p, "How qualified leads book"), card(p, "Appointment shape")],
    markers: (p) => [{ locator: p.getByText("Qualified leads are offered slots from your calendar", { exact: false }).first().locator("xpath=ancestor::label[1]") }, { locator: p.locator("#booking-duration") }, { locator: p.locator("#booking-buffer") }],
    caption: "Set the shape of appointments offered from your calendar",
    alt: "How qualified leads book with Google Calendar selected and the appointment duration and buffer fields",
  },
  {
    id: "connections-toast",
    simulated: true,
    tidy: false,
    article: "connections-settings",
    file: "settings/connections-settings-2.png",
    row: "connections-settings-toast.png",
    url: CONNECTIONS,
    prepare: async (p) => {
      // The toast dismisses itself after six seconds; the fake clock holds it.
      await p.clock.install();
      await p.goto(`${new URL(p.url()).origin}${CONNECTIONS}&connected=meta`, { waitUntil: "domcontentloaded" });
      await toast(p).waitFor({ state: "visible", timeout: 20_000 });
      await p.clock.pauseAt(new Date(Date.now() + 2_000));
    },
    region: (p) => toast(p),
    pad: 36,
    markers: (p) => [{ locator: toast(p) }],
    caption: "A message confirms each connection",
    alt: "The confirmation message Meta Lead Ads connected, shown after connecting Meta",
  },
  {
    id: "social-accounts",
    simulated: true,
    article: "connections-settings",
    file: "settings/connections-settings-3.png",
    row: "connections-settings-social-accounts.png",
    url: CONNECTIONS,
    prepare: async (p) => {
      const c = card(p, "Social sending accounts");
      await c.scrollIntoViewIfNeeded();
      await c.getByRole("button", { name: "Add account" }).click();
      await p.waitForTimeout(700);
    },
    region: (p) => card(p, "Social sending accounts"),
    markers: (p) => [
      { locator: cardOf(card(p, "Social sending accounts").getByText(/Alex Morgan \(demo\)/)) },
      { locator: card(p, "Social sending accounts").getByRole("combobox").nth(0) },
      { locator: card(p, "Social sending accounts").getByRole("combobox").nth(1) },
    ],
    caption: "Tell ClientTurn which accounts your team sends from",
    alt: "Social sending accounts with one LinkedIn Sales Navigator account and the add form open with Platform and Subscription",
  },
  {
    id: "whatsapp-templates-panel",
    simulated: true,
    article: "connections-settings",
    file: "settings/connections-settings-4.png",
    row: "connections-settings-whatsapp-templates.png",
    url: CONNECTIONS,
    region: (p) => card(p, "WhatsApp templates"),
    markers: (p) => [{ locator: card(p, "WhatsApp templates").getByRole("button", { name: "Sync" }) }, { locator: card(p, "WhatsApp templates").getByText("Approved", { exact: true }).first() }, { locator: card(p, "WhatsApp templates").getByRole("combobox").first() }],
    caption: "Sync approved templates and choose one for each WhatsApp step",
    alt: "The WhatsApp templates card with two approved templates and a follow-up step mapped to a template",
  },
  {
    id: "whatsapp-step-mapping",
    simulated: true,
    article: "whatsapp-templates",
    file: "integrations/whatsapp-templates-1.png",
    row: "whatsapp-templates-step-mapping.png",
    url: CONNECTIONS,
    region: (p) => cardOf(card(p, "WhatsApp templates").getByText("Template when the 24-hour window has closed")),
    markers: (p) => [{ locator: card(p, "WhatsApp templates").getByRole("combobox").first() }, { locator: card(p, "WhatsApp templates").getByText(/Fill \{\{1\}\} with/) }],
    caption: "Choose the approved template each step sends after 24 hours",
    alt: "A WhatsApp follow-up step with its approved template chosen and each template variable mapped to a lead field",
  },
  {
    id: "linkedin-reconnect",
    simulated: true,
    article: "connecting-linkedin",
    file: "integrations/connecting-linkedin-2.png",
    row: "connecting-linkedin-reconnect.png",
    url: CONNECTIONS,
    before: (ctx) => setLinkedIn(ctx, "ACTION_REQUIRED"),
    after: (ctx) => setLinkedIn(ctx, "HEALTHY"),
    region: (p) => providerCard(p, "LinkedIn Lead Gen Forms"),
    markers: (p) => [{ locator: providerCard(p, "LinkedIn Lead Gen Forms").getByText(/403/) }],
    caption: "LinkedIn's reason is shown on the card",
    alt: "The LinkedIn Lead Gen Forms card in Reconnect required, showing LinkedIn's error message",
  },
  {
    id: "troubleshooting-health",
    simulated: true,
    article: "troubleshooting-integrations",
    file: "integrations/troubleshooting-integrations-1.png",
    row: "troubleshooting-integrations-health.png",
    url: CONNECTIONS,
    before: (ctx) => setLinkedIn(ctx, "ACTION_REQUIRED"),
    after: (ctx) => setLinkedIn(ctx, "HEALTHY"),
    region: (p) => [card(p, "Connection health"), providerCard(p, "LinkedIn Lead Gen Forms")],
    markers: (p) => [{ locator: card(p, "Connection health") }, { locator: providerCard(p, "LinkedIn Lead Gen Forms") }],
    caption: "Problems at a glance",
    alt: "The Connection health summary above the lead-source cards, with LinkedIn Lead Gen Forms needing a reconnect",
  },
);

/* ------------------------------------------------ seeded (not simulated) */

SHOTS.push({
  id: "domain-health",
  article: "setting-up-email-outreach",
  file: "integrations/setting-up-email-outreach-2.png",
  row: "setting-up-email-outreach-domain-health.png",
  url: CONNECTIONS,
  region: (p) => card(p, "Sending domain health"),
  markers: (p) => [{ locator: card(p, "Sending domain health").locator("table, [role='table']").first() }],
  caption: "SPF, DKIM and DMARC are checked daily",
  alt: "The Sending domain health table with SPF, DKIM and DMARC passing for the demo sending domain",
});

/* ------------------------------------------------ batch 3 */

const DEVELOPER = "/app/settings?section=developer";
const EXAMPLE_KEY = "Help centre example key";
const EXAMPLE_CONNECTION = "Help centre example connection";
const dialogWith = (p, title) => p.getByRole("dialog").filter({ hasText: title }).first();

async function openInbound(p, app, method) {
  const c = card(p, app);
  await c.scrollIntoViewIfNeeded();
  await c.getByRole("button", { name: /Set up/ }).first().click();
  await p.waitForTimeout(700);
  if (method) {
    await p.getByText(method, { exact: true }).first().click();
    await p.waitForTimeout(400);
  }
}
const inboundPanel = (p) => cardOf(p.getByText("Inbound contact endpoint", { exact: true }).first());

/** Deletes the example rows by name (a connection's key is named "<name> (MCP) [mcp:<id>]"). */
async function removeByName(ctx, table, name) {
  const { error } = await ctx.admin.from(table).delete().eq("business_id", ctx.businessId).like("name", `${name}%`);
  if (error) throw new Error(`${table} cleanup: ${error.message}`);
}

SHOTS.push(
  {
    id: "zapier-setup",
    article: "leads-from-zapier-and-webhooks",
    file: "finding-leads/leads-from-zapier-and-webhooks-1.png",
    row: "leads-from-zapier-and-webhooks-setup.png",
    url: CONNECTIONS,
    prepare: (p) => openInbound(p, "Zapier", "Bearer token"),
    region: (p) => inboundPanel(p),
    markers: (p) => [
      { locator: cardOf(p.getByText("Bearer token", { exact: true }).first()) },
      { locator: cardOf(p.getByText("API key header", { exact: true }).first()) },
      { locator: button(p, "Create endpoint") },
    ],
    caption: "Choose Bearer token or API key header for Zapier",
    alt: "The Zapier inbound endpoint set-up with Bearer token chosen as the authentication method and the Create endpoint button",
  },
  {
    id: "pipedrive-setup",
    article: "connecting-pipedrive",
    file: "integrations/connecting-pipedrive-1.png",
    row: "connecting-pipedrive-setup.png",
    url: CONNECTIONS,
    prepare: (p) => openInbound(p, "Pipedrive", "Basic authentication"),
    region: (p) => inboundPanel(p),
    markers: (p) => [{ locator: cardOf(p.getByText("Basic authentication", { exact: true }).first()) }, { locator: button(p, "Create endpoint") }],
    caption: "Basic authentication works with Pipedrive's webhook field",
    alt: "The Pipedrive inbound endpoint set-up with Basic authentication chosen and the Create endpoint button",
  },
  {
    id: "custom-webhook-setup",
    article: "connecting-pipedrive-and-other-crms",
    file: "integrations/connecting-pipedrive-and-other-crms-1.png",
    row: "connecting-pipedrive-and-other-crms-custom.png",
    url: CONNECTIONS,
    prepare: (p) => openInbound(p, "Custom webhook", "Signed request (HMAC-SHA256)"),
    region: (p) => inboundPanel(p),
    markers: (p) => [{ locator: cardOf(p.getByText("Signed request (HMAC-SHA256)", { exact: true }).first()) }],
    caption: "Use a signed request wherever the tool supports it",
    alt: "The Custom webhook inbound endpoint set-up with Signed request (HMAC-SHA256) chosen",
  },
  {
    id: "unsubscribe-page",
    article: "suppression-and-unsubscribe",
    file: "compliance/suppression-and-unsubscribe-3.png",
    row: "suppression-and-unsubscribe-page.png",
    url: "/unsubscribe/__GRACE_TOKEN__",
    before: async (ctx) => {
      const { data } = await ctx.admin.from("leads").select("unsubscribe_token").eq("id", ctx.leadIds.grace).single();
      ctx.graceToken = data.unsubscribe_token;
    },
    resolveUrl: (ctx, url) => url.replace("__GRACE_TOKEN__", ctx.graceToken),
    region: (p) => cardOf(p.getByRole("heading").first()),
    markers: (p) => [{ locator: p.getByRole("heading").first() }, { locator: p.getByRole("button").first() }],
    caption: "The unsubscribe link asks the person to confirm",
    alt: "The public unsubscribe page asking the person to confirm unsubscribing from Blackwellen Ltd",
  },
  {
    id: "linkedin-filters",
    article: "linkedin-sales-navigator-assisted",
    file: "finding-leads/linkedin-sales-navigator-assisted-3.png",
    row: "linkedin-sales-navigator-assisted-filters.png",
    url: "/app/find-leads?view=discover",
    prepare: async (p) => {
      await openSession(p);
      await p.getByText("LinkedIn filters", { exact: true }).first().click();
      await p.getByRole("dialog").first().waitFor({ state: "visible" });
      await p.getByRole("dialog").getByText("Import your list (CSV)").first().scrollIntoViewIfNeeded();
      await p.waitForTimeout(700);
    },
    region: (p) => p.getByRole("dialog").first(),
    pad: 0,
    markers: (p) => [
      { locator: p.getByRole("dialog").getByText("Search LinkedIn").first() },
      { locator: p.getByRole("dialog").getByText("Copy filters").first() },
      { locator: p.getByRole("dialog").getByText("Import your list (CSV)").first() },
    ],
    caption: "Apply the filters in LinkedIn, or import your own list",
    alt: "The LinkedIn filters for the search plan with Search LinkedIn, Copy filters and Import your list (CSV)",
  },
  {
    id: "team-remove",
    article: "team-settings",
    file: "settings/team-settings-2.png",
    row: "team-settings-remove-dialog.png",
    url: "/app/settings?section=team",
    prepare: async (p) => {
      await p.locator("tr", { hasText: "Tom Ashby" }).getByRole("button").last().click();
      await p.waitForTimeout(400);
      await p.getByRole("menuitem", { name: /Remove/ }).first().click();
      await p.getByRole("dialog").first().waitFor({ state: "visible" });
      await p.waitForTimeout(600);
    },
    region: (p) => p.getByRole("dialog").first(),
    markers: (p) => [{ locator: p.getByRole("dialog").getByRole("combobox").first() }],
    caption: "Choose who inherits their open work before removing someone",
    alt: "The Remove member dialog for Tom Ashby with the Give their open work to select",
  },
  {
    id: "api-key-reveal",
    article: "api-keys",
    file: "developers/api-keys-2.png",
    row: "api-keys-reveal.png",
    url: DEVELOPER,
    before: (ctx) => removeByName(ctx, "api_keys", EXAMPLE_KEY),
    prepare: async (p) => {
      await button(p, "New key").click();
      const d = dialogWith(p, "New API key");
      await d.getByPlaceholder("Zapier: lead sync").fill(EXAMPLE_KEY);
      await d.getByText("leads:read", { exact: true }).first().click();
      await d.getByRole("button", { name: "Create key" }).click();
      await dialogWith(p, "Copy this key now").waitFor({ state: "visible" });
      await p.waitForTimeout(600);
    },
    region: (p) => dialogWith(p, "Copy this key now"),
    markers: (p) => [{ locator: dialogWith(p, "Copy this key now").locator("code").first() }],
    caption: "The key is shown once",
    alt: "The Copy this key now dialog showing a newly created API key (deleted straight after this screenshot)",
    // The key is deleted as soon as the image is taken.
    after: (ctx) => removeByName(ctx, "api_keys", EXAMPLE_KEY),
  },
  {
    id: "mcp-new-connection",
    article: "connect-an-ai-assistant",
    file: "developers/connect-an-ai-assistant-1.png",
    row: "connect-an-ai-assistant-new-connection.png",
    url: DEVELOPER,
    before: async (ctx) => {
      await removeByName(ctx, "api_keys", EXAMPLE_CONNECTION);
      await removeByName(ctx, "mcp_clients", EXAMPLE_CONNECTION);
    },
    prepare: async (p) => {
      await button(p, "New connection").click();
      const d = p.getByRole("dialog").first();
      await d.getByPlaceholder("Claude on my laptop").fill(EXAMPLE_CONNECTION);
      await d.getByText("leads:read", { exact: true }).first().click();
      await d.getByRole("button", { name: "Create connection" }).click();
      await dialogWith(p, "Copy this key now").waitFor({ state: "visible" });
      await p.waitForTimeout(600);
    },
    region: (p) => dialogWith(p, "Copy this key now"),
    markers: (p) => [{ locator: dialogWith(p, "Copy this key now").getByText(/MCP server URL/).first() }, { locator: dialogWith(p, "Copy this key now").locator("code").nth(1) }, { locator: dialogWith(p, "Copy this key now").getByText(/Client configuration/).first() }],
    caption: "Copy the key and configuration into your assistant; it is shown once",
    alt: "The new assistant connection dialog with the MCP server URL, the key and the client configuration (the connection was deleted straight after)",
    after: async (ctx) => {
      await removeByName(ctx, "api_keys", EXAMPLE_CONNECTION);
      await removeByName(ctx, "mcp_clients", EXAMPLE_CONNECTION);
    },
  },
  {
    id: "data-rights-erase",
    once: true,
    article: "data-rights",
    file: "compliance/data-rights-3.png",
    row: "data-rights-erase-outcome.png",
    url: "/app/leads/__ERASE__?tab=data-rights",
    resolveUrl: (ctx, url) => {
      if (!ctx.leadIds.erase) throw new Error("the throwaway lead is already erased");
      return url.replace("__ERASE__", ctx.leadIds.erase);
    },
    prepare: async (p) => {
      // Irreversible, on the throwaway fictional lead kept for this image.
      await p.getByRole("button", { name: "Erase…" }).click();
      await p.getByRole("button", { name: "Erase lead" }).click();
      await p.getByText("What was kept", { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
      await p.waitForTimeout(800);
    },
    region: (p) => cardOf(p.getByText("What was kept", { exact: false }).first()),
    markers: (p) => [{ locator: p.getByText("What changed", { exact: false }).first() }, { locator: p.getByText("What was kept", { exact: false }).first() }],
    caption: "After erasing, ClientTurn lists what was removed and what was kept",
    alt: "The outcome of erasing a throwaway demo lead: what changed and what was kept",
  },
);

/* ------------------------------------------------ intent signals
 * Capture these with the server started WITHOUT COMPANIES_HOUSE_API_KEY
 * (`COMPANIES_HOUSE_API_KEY= npx next start ...`), so the Companies House
 * signal types show as unavailable with their reason, as the article describes.
 * Run them on their own: --only intent-catalogue,intent-combination */

async function openPlanRow(p, row) {
  await openSession(p);
  await p.getByText(row, { exact: true }).first().click();
  await p.getByRole("dialog").first().waitFor({ state: "visible" });
  await p.waitForTimeout(700);
}

SHOTS.push(
  {
    id: "intent-catalogue",
    needsNoCompaniesHouseKey: true,
    article: "intent-signals-explained",
    file: "finding-leads/intent-signals-explained-1.png",
    row: "intent-signals-explained-catalogue.png",
    url: "/app/find-leads?view=discover",
    prepare: (p) => openPlanRow(p, "Signals"),
    region: (p) => p.getByRole("dialog").first(),
    pad: 0,
    markers: (p) => [
      { locator: p.getByRole("dialog").getByText(/Needs a Companies House API key/).first().locator("xpath=..") },
      { locator: p.getByRole("dialog").getByText("More buying signals", { exact: true }).first(), box: false },
    ],
    caption: "Pick signals backed by a free source; unavailable ones say why",
    alt: "The Buying signals editor with the Companies House signals greyed out because no Companies House key is set, and the More buying signals catalogue",
  },
  {
    id: "intent-combination",
    article: "intent-signals-explained",
    file: "finding-leads/intent-signals-explained-2.png",
    row: "intent-signals-explained-combination.png",
    url: "/app/find-leads?view=discover",
    prepare: (p) => openPlanRow(p, "Combination"),
    region: (p) => p.getByRole("dialog").first(),
    pad: 0,
    markers: (p) => [
      { locator: p.getByRole("dialog").getByText(/^Raised funds or changed ownership in the last 90 days AND/).first() },
      { locator: p.getByRole("dialog").getByRole("button", { name: "All conditions (AND)" }) },
    ],
    caption: "Combine signals with AND or OR, each with its own time window",
    alt: "The Combine signals editor for Raised funds and hiring marketing, with All conditions (AND) selected and two conditions",
  },
);

/* ------------------------------------------------ batch 4: billing, import, reactivation */

const BILLING = "/app/settings?section=billing";

async function subscriptionPatch(ctx, patch) {
  const { error } = await ctx.admin.from("subscriptions").update(patch).eq("business_id", ctx.businessId);
  if (error) throw new Error(`subscription: ${error.message}`);
}
const RESTORE_SUBSCRIPTION = { plan: "pro", status: "ACTIVE", trial_ends_at: null, payment_method_brand: null, payment_method_last4: null, payment_method_verified_at: null, whatsapp_enabled: true };

/** A fictional 20-row list: names and companies invented, every address on .example. */
export function demoCsv() {
  const rows = [["first_name", "last_name", "email", "company", "job_title"]];
  const people = [
    ["Aaron", "Kettle", "Ashbrindle Software Ltd"], ["Bethan", "Lowe", "Kelvermoor Retail Ltd"], ["Carys", "Mott", "Oxenhythe Analytics Ltd"],
    ["Declan", "Faye", "Pellowmarsh Consulting Ltd"], ["Esme", "Rudd", "Hollinbrook Foods Ltd"], ["Felix", "Garner", "Vardenhall Studio Ltd"],
    ["Gemma", "Hollis", "Quarrywick Engineering Ltd"], ["Hamish", "Irwin", "Wickenmoor Health Ltd"], ["Imogen", "Joyce", "Brackwater Logistics Ltd"],
    ["Jonah", "Keane", "Lumbercote Interiors Ltd"], ["Keira", "Lamb", "Rookhaven Partners Ltd"], ["Liam", "Moss", "Tessendale Consulting Ltd"],
    ["Maya", "Noble", "Marlowgate Retail Ltd"], ["Nathan", "Orr", "Corrowick Software Ltd"], ["Olive", "Parr", "Ashbrindle Software Ltd"],
    ["Pavel", "Quint", "Kelvermoor Retail Ltd"], ["Ruby", "Stokes", "Oxenhythe Analytics Ltd"],
  ];
  for (const [first, last, company] of people) {
    const core = company.split(" ")[0].toLowerCase();
    rows.push([first, last, `${first.toLowerCase()}.${last.toLowerCase()}@${core}.example`, company, "Marketing Manager"]);
  }
  // A duplicate of an existing lead, a suppressed (opted-out) lead, and a row with no email.
  rows.push(["Harriet", "Quayle", "harriet.quayle@quillfield.example", "Quillfield Analytics Ltd", "Head of Marketing"]);
  rows.push(["Ethan", "Doyle", "ethan.doyle@calderwyck.example", "Calderwyck Recruitment Ltd", "Director"]);
  rows.push(["Sian", "Tate", "", "Tessendale Consulting Ltd", "Office Manager"]);
  rows.push(["Tobias", "Vale", "tobias.vale-at-tessendale", "Tessendale Consulting Ltd", "Director"]);
  return rows.map((r) => r.join(",")).join("\n") + "\n";
}

async function importToRelationship(p) {
  await p.locator('input[type="file"]').first().setInputFiles({ name: "help-demo-list.csv", mimeType: "text/csv", buffer: Buffer.from(demoCsv()) });
  await p.waitForTimeout(800);
  await button(p, /^Continue/, false).click();
  await p.waitForTimeout(600);
  await p.locator("label", { hasText: "Existing business relationship" }).first().click();
  await p.waitForTimeout(400);
}

async function removeDemoImports(ctx) {
  await ctx.admin.from("lead_imports").delete().eq("business_id", ctx.businessId).eq("filename", "help-demo-list.csv");
}

async function reactivationToMessage(p, { channel } = {}) {
  await p.getByPlaceholder("Spring strategy check-in").fill("Autumn website check-in");
  await p.getByText("90 days", { exact: true }).first().click();
  await p.getByRole("listbox").getByText("30 days", { exact: true }).first().click();
  await p.waitForTimeout(800);
  await p.getByText(/estimated eligible contacts/).first().waitFor({ state: "visible", timeout: 20_000 });
  await p.getByRole("button", { name: /Continue to Message/ }).click();
  await p.waitForTimeout(900);
  if (channel) {
    await p.getByText("Channel", { exact: true }).first().locator("xpath=following::button[1]").click();
    await p.waitForTimeout(400);
    await p.getByRole("listbox").getByText(channel, { exact: false }).first().click();
    await p.waitForTimeout(900);
  }
}

SHOTS.push(
  {
    id: "trial-status",
    article: "free-trial",
    file: "billing/free-trial-2.png",
    row: "free-trial-status-card.png",
    url: BILLING,
    before: (ctx) => subscriptionPatch(ctx, { status: "TRIALING", trial_ends_at: new Date(Date.now() + 9 * 86_400_000).toISOString(), payment_method_brand: "visa", payment_method_last4: "4242", payment_method_verified_at: new Date().toISOString() }),
    after: (ctx) => subscriptionPatch(ctx, RESTORE_SUBSCRIPTION),
    region: (p) => card(p, "Subscription status"),
    markers: (p) => [{ locator: card(p, "Subscription status").getByText(/^Trial ends/).first() }, { locator: card(p, "Subscription status").getByText(/4242/).first() }],
    caption: "Billing & Usage shows when the trial ends and the card on file",
    alt: "The Subscription status card during a trial, showing when the trial ends and the card on file ending 4242",
  },
  {
    id: "starter-no-whatsapp",
    article: "top-up-credits",
    file: "billing/top-up-credits-3.png",
    row: "top-up-credits-starter-no-whatsapp.png",
    url: BILLING,
    before: (ctx) => subscriptionPatch(ctx, { plan: "starter", whatsapp_enabled: false }),
    after: (ctx) => subscriptionPatch(ctx, RESTORE_SUBSCRIPTION),
    region: (p) => card(p, "Message credits"),
    markers: (p) => [{ locator: card(p, "Message credits").getByText(/WhatsApp is a paid add-on/).first() }],
    caption: "WhatsApp token packs appear only on plans with WhatsApp",
    alt: "The Message credits card on the Starter plan with SMS bundles only and the note that WhatsApp is a paid add-on on Growth and above",
  },
  {
    id: "top-up-bundles",
    article: "top-up-credits",
    file: "billing/top-up-credits-1.png",
    row: "top-up-credits-message-bundles.png",
    url: BILLING,
    region: (p) => card(p, "Message credits"),
    markers: (p) => [
      { locator: cardOf(card(p, "Message credits").getByText(/SMS credit/).first()) },
      { locator: card(p, "Message credits").getByRole("button", { name: /Buy/ }).first() },
      { locator: card(p, "Message credits").getByText(/Non-refundable once any credit is used/).first() },
    ],
    caption: "Buy SMS credit or WhatsApp tokens here; neither expires",
    alt: "The Message credits card with the SMS credit and WhatsApp token balances, the bundles with Buy buttons and the refund notice",
  },
  {
    id: "daily-caps",
    article: "usage-and-limits",
    file: "billing/usage-and-limits-2.png",
    row: "usage-and-limits-daily-caps.png",
    url: BILLING,
    region: (p) => cardOf(p.getByText(/Daily sending limits/).first()),
    markers: (p) => [
      { locator: p.getByText(/Daily sending limits/).first().locator("xpath=following::input[1]") },
      { locator: p.getByText(/Up to \d[\d,]* per day/).first() },
      { locator: button(p, "Save daily limits") },
    ],
    caption: "Lower a daily limit to pace sending; you cannot raise it above the ceiling",
    alt: "Communication allocation with the Daily sending limits for email, SMS and WhatsApp, their per-day ceilings and Save daily limits",
  },
  {
    id: "import-relationship",
    article: "importing-a-csv",
    file: "finding-leads/importing-a-csv-1.png",
    row: "importing-a-csv-relationship.png",
    url: "/app/leads/import",
    prepare: importToRelationship,
    region: (p) => card(p, "How do you know these people?"),
    markers: (p) => [{ locator: p.locator("label", { hasText: "Existing business relationship" }).first() }, { locator: p.getByText("Start follow-up on imported leads").first().locator("xpath=ancestor::label[1]") }],
    caption: "This answer decides whether rows become leads or prospects",
    alt: "Step 3 of the CSV import, How do you know these people?, with Existing business relationship chosen and the Start follow-up on imported leads option",
  },
  {
    id: "import-review",
    article: "importing-a-csv",
    file: "finding-leads/importing-a-csv-2.png",
    row: "importing-a-csv-review.png",
    url: "/app/leads/import",
    before: removeDemoImports,
    prepare: async (p) => {
      await importToRelationship(p);
      await button(p, /^Continue/, false).click();
      await p.waitForTimeout(600);
      await button(p, "Check against your workspace").click();
      await p.getByText("Decide the rows we are unsure about").first().waitFor({ state: "visible", timeout: 30_000 });
      await p.waitForTimeout(800);
    },
    region: (p) => card(p, "Decide the rows we are unsure about"),
    markers: (p) => [{ locator: card(p, "Decide the rows we are unsure about").getByRole("button", { name: /Lead|Prospect|Skip/ }).first() }],
    caption: "Decide the rows ClientTurn is unsure about",
    alt: "The import review listing rows ClientTurn is unsure about, including a duplicate and an opted-out person, each with Lead, Prospect and Skip choices",
    // Staged, never committed: nothing is imported. The staging rows are removed.
    after: removeDemoImports,
  },
  {
    id: "reactivation-review",
    article: "reactivation-overview",
    file: "reactivation/reactivation-overview-2.png",
    row: "reactivation-overview-review.png",
    url: "/app/reactivation/new",
    prepare: async (p) => {
      await reactivationToMessage(p);
      await p.locator("textarea").first().fill("Hi {first_name}, it's Alex at Blackwellen. You asked about a new website a while ago. Is it still on the cards this year?");
      await p.waitForTimeout(500);
      await p.getByRole("button", { name: /Continue to Review/ }).click();
      await p.getByText("Launch checklist").first().waitFor({ state: "visible" });
      await p.waitForTimeout(900);
    },
    region: (p) => [card(p, "Launch checklist"), card(p, "Step 3: Review & Launch")],
    markers: (p) => [
      { locator: card(p, "Launch checklist") },
      { locator: p.getByText("Suppression reasons", { exact: true }).first().locator("xpath=ancestor::section[1]") },
      { locator: p.getByText(/Ready to launch/).first() },
    ],
    caption: "Check the summary and exclusions, then launch",
    alt: "The Review and Launch step of a reactivation campaign with the launch checklist, the suppression reasons and the ready-to-launch summary (the campaign was not launched)",
  },
  {
    id: "reactivation-csv-mapping",
    article: "reactivating-a-csv-list",
    file: "reactivation/reactivating-a-csv-list-1.png",
    row: "reactivating-a-csv-list-mapping.png",
    url: "/app/reactivation/new",
    prepare: async (p) => {
      await p.getByText("Import from CSV", { exact: true }).first().click();
      await p.waitForTimeout(500);
      await p.locator('input[type="file"]').first().setInputFiles({ name: "help-demo-list.csv", mimeType: "text/csv", buffer: Buffer.from(demoCsv()) });
      await p.waitForTimeout(1200);
      await button(p, "Validate file").click();
      await p.getByText(/Valid contacts/).first().waitFor({ state: "visible", timeout: 20_000 });
      await p.waitForTimeout(800);
    },
    region: (p) => cardOf(p.getByText("help-demo-list.csv", { exact: true }).first()),
    markers: (p) => [{ locator: p.getByText(/Valid contacts/).first() }, { locator: p.getByText(/Invalid rows/).first() }, { locator: p.getByRole("button", { name: /^Import/ }).first() }],
    caption: "Map your columns and fix invalid rows before importing",
    alt: "The reactivation CSV import after the columns were mapped and the file validated: total, valid and invalid rows, and the Import button (not pressed)",
  },
  {
    id: "reactivation-whatsapp",
    simulated: true,
    article: "whatsapp-templates-for-reactivation",
    file: "reactivation/whatsapp-templates-for-reactivation-1.png",
    row: "whatsapp-templates-for-reactivation-picker.png",
    url: "/app/reactivation/new",
    prepare: async (p) => {
      await reactivationToMessage(p, { channel: "WhatsApp" });
      await p.getByText("Choose a template", { exact: true }).first().click();
      await p.waitForTimeout(400);
      await p.getByRole("listbox").getByText(/project_check_in/).first().click();
      await p.waitForTimeout(800);
    },
    region: (p) => cardOf(p.getByText(/Approved WhatsApp template/).first()),
    markers: (p) => [
      { locator: cardOf(p.getByText(/Approved WhatsApp template/).first()).locator("button").first() },
      { locator: cardOf(p.getByText(/Approved WhatsApp template/).first()).locator("button").nth(1) },
    ],
    caption: "Choose the approved template and fill each variable",
    alt: "The Message and Timing step for a WhatsApp reactivation campaign with the approved WhatsApp template select and its variables",
  },
);
