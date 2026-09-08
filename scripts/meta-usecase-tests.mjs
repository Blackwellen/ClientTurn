/**
 * Makes the successful API calls Meta requires before an app can be submitted
 * for App Review.
 *
 *   node scripts/meta-usecase-tests.mjs --token "<user access token>"
 *   node scripts/meta-usecase-tests.mjs --token "<token>" --dry-run
 *
 * ## What this is for
 *
 * The App Dashboard's "Testing your use cases" panel shows a counter per
 * permission — "0 of 1 API call(s) required". Those are not documentation
 * checkboxes: Meta wants to see a real, successful call against each permission
 * from your app before it will accept a review submission. This script makes
 * exactly those calls, once each, and reports which counters it should have
 * moved.
 *
 * Meta says test data can take up to 24 hours to appear, and each test is valid
 * for 30 days. So run this, wait, then submit — and if a submission slips past
 * the 30-day mark, run it again.
 *
 * ## Getting the token
 *
 * Graph API Explorer → select the Client Turn app → "User Token" → add the
 * permissions listed in `REQUIRED_SCOPES` below → Generate Access Token. It is
 * short-lived, which is fine; this script finishes in seconds.
 *
 * The token is passed on the command line and never written anywhere. It is a
 * credential with access to your Pages — treat it like a password and let it
 * expire rather than storing it.
 *
 * ## What it deliberately does NOT do
 *
 * Every call here is a **read**, with two exceptions that are explicitly opt-in
 * (`--subscribe`). Nothing posts a message, creates an ad, or writes to a Page.
 * A script that ticks a review checkbox by messaging a real person would be a
 * worse problem than an unsubmitted app.
 */

import process from "node:process";

const GRAPH = "https://graph.facebook.com/v21.0";

/** The permissions ClientTurn actually uses. Nothing else is requested. */
const REQUIRED_SCOPES = [
  "public_profile",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "leads_retrieval",
  // Required, and not obviously so. Reading `/{page}/leadgen_forms` — which the
  // lead poller does, as the backstop for a webhook Meta failed to deliver —
  // returns `(#200) Requires pages_manage_ads permission to manage the object`
  // without it. `leads_retrieval` alone only covers reading an individual
  // submission by its id, which is the webhook path.
  "pages_manage_ads",
  "business_management",
];

/**
 * WhatsApp, only if you are going direct to Meta's Cloud API.
 *
 * Today WhatsApp runs through Twilio, which is an official Meta Business
 * Solution Provider — so the messages are genuine WhatsApp Business messages
 * and **no Meta App Review is required for them at all**. Twilio holds the
 * platform relationship; we hold an account with Twilio.
 *
 * Going direct removes Twilio's per-message markup and gives you Meta's own
 * pricing, but it is a build (a second transport in `lib/messaging`) plus
 * Business Verification plus review of the two permissions below. Run with
 * `--whatsapp` once that decision is made; until then these are correctly
 * absent, and the WhatsApp use case can stay on the app without blocking
 * anything.
 */
const WHATSAPP_SCOPES = ["whatsapp_business_management", "whatsapp_business_messaging"];

/* ------------------------------------------------------------------- args */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const FLAG = (name) => process.argv.includes(`--${name}`);

const TOKEN = arg("token") ?? process.env.META_USER_TOKEN;
const DRY_RUN = FLAG("dry-run");
const SUBSCRIBE = FLAG("subscribe");
const WHATSAPP = FLAG("whatsapp");

const SCOPES = WHATSAPP ? [...REQUIRED_SCOPES, ...WHATSAPP_SCOPES] : REQUIRED_SCOPES;

if (!TOKEN) {
  console.error(
    "Usage: node scripts/meta-usecase-tests.mjs --token \"<user access token>\"\n" +
      "\n" +
      "Generate one in Graph API Explorer with these permissions:\n  " +
      SCOPES.join("\n  "),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ calls */

const results = [];

async function call(label, permission, path, init) {
  if (DRY_RUN) {
    console.log(`  DRY  ${permission.padEnd(28)} ${label}`);
    results.push({ permission, label, ok: null });
    return null;
  }

  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(TOKEN)}`;

  try {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));

    if (body.error) {
      console.log(
        `  FAIL ${permission.padEnd(28)} ${label}\n       code=${body.error.code}${
          body.error.error_subcode ? `/${body.error.error_subcode}` : ""
        } ${body.error.message}`,
      );
      results.push({ permission, label, ok: false, error: body.error.message });
      return null;
    }

    const count = Array.isArray(body.data) ? ` (${body.data.length} rows)` : "";
    console.log(`  OK   ${permission.padEnd(28)} ${label}${count}`);
    results.push({ permission, label, ok: true });
    return body;
  } catch (error) {
    console.log(`  ERR  ${permission.padEnd(28)} ${label} — ${error.message}`);
    results.push({ permission, label, ok: false, error: error.message });
    return null;
  }
}

/* ------------------------------------------------------------------- run */

console.log("\nMeta use-case test calls — ClientTurn\n");
if (DRY_RUN) console.log("(dry run — nothing will be sent)\n");

console.log("Identity and Pages");
await call("GET /me", "public_profile", "/me?fields=id,name");
const accounts = await call(
  "GET /me/accounts",
  "pages_show_list",
  "/me/accounts?fields=id,name,access_token,instagram_business_account",
);

// In a dry run there is no real response, so a placeholder stands in — the
// point of --dry-run is to show the full plan of calls before anyone generates
// a token, and stopping at step two would show almost none of it.
// Which Page to work with.
//
// Taking `data[0]` is a coin toss once somebody administers more than one, and
// the Instagram half of the run is skipped entirely if the Page it happens to
// pick has no linked account. So: an explicit --page wins, otherwise prefer a
// Page that actually has Instagram linked, and only then fall back to the first.
const pages = accounts?.data ?? [];
const requestedPage = arg("page");

const page = DRY_RUN
  ? { id: "{page-id}", name: "(dry run)", access_token: "", instagram_business_account: { id: "{ig-id}" } }
  : (requestedPage
      ? pages.find((candidate) => candidate.id === requestedPage) ?? null
      : (pages.find((candidate) => candidate.instagram_business_account?.id) ??
         pages[0] ??
         null));

if (!DRY_RUN && pages.length > 1) {
  console.log(`\n  ${pages.length} Pages available:`);
  for (const candidate of pages) {
    const ig = candidate.instagram_business_account?.id ? " · Instagram linked" : "";
    const mark = candidate.id === page?.id ? "→" : " ";
    console.log(`  ${mark} ${candidate.name} (${candidate.id})${ig}`);
  }
  console.log("  Use --page <id> to choose a different one.");
}

if (!page) {
  console.log(
    "\nNo Page came back. Every remaining check needs one, so nothing further can run.\n" +
      "Make sure the token has pages_show_list and that your user has a role on at least one Page.\n",
  );
  process.exit(1);
}

console.log(`\nUsing Page: ${page.name} (${page.id})`);

// From here on the *Page* token is the right credential. A user token works for
// some Page edges and not others, and Meta records the permission against
// whichever was used — so using the Page token throughout is what makes the
// counters move for the Page permissions.
const PAGE_TOKEN = page.access_token;
const asPage = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(PAGE_TOKEN)}`;

async function pageCall(label, permission, path, init) {
  if (DRY_RUN) {
    console.log(`  DRY  ${permission.padEnd(28)} ${label}`);
    results.push({ permission, label, ok: null });
    return null;
  }
  const url = `${GRAPH}${asPage(path)}`;
  try {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (body.error) {
      console.log(
        `  FAIL ${permission.padEnd(28)} ${label}\n       code=${body.error.code}${
          body.error.error_subcode ? `/${body.error.error_subcode}` : ""
        } ${body.error.message}`,
      );
      results.push({ permission, label, ok: false, error: body.error.message });
      return null;
    }
    const count = Array.isArray(body.data) ? ` (${body.data.length} rows)` : "";
    console.log(`  OK   ${permission.padEnd(28)} ${label}${count}`);
    results.push({ permission, label, ok: true });
    return body;
  } catch (error) {
    console.log(`  ERR  ${permission.padEnd(28)} ${label} — ${error.message}`);
    results.push({ permission, label, ok: false, error: error.message });
    return null;
  }
}

console.log("\nPage reads — the discovery half of flows 1 and 3");
await pageCall(
  "GET /{page}?fields=fan_count",
  "pages_read_engagement",
  `/${page.id}?fields=id,name,fan_count,followers_count`,
);
const feed = await pageCall(
  "GET /{page}/feed  (comments we may privately reply to)",
  "pages_read_engagement",
  `/${page.id}/feed?fields=id,message,created_time,comments{id,from,message,created_time}&limit=5`,
);

if (!feed && !DRY_RUN) {
  // `/feed` includes visitor posts, which is why Meta gates it behind Page
  // Public Content Access. `/published_posts` is only the Page's own content —
  // which is all this product ever reads — and is covered by
  // pages_read_engagement alone.
  await pageCall(
    "GET /{page}/published_posts  (our own posts only)",
    "pages_read_engagement",
    `/${page.id}/published_posts?fields=id,message,created_time,comments{id,from,message,created_time}&limit=5`,
  );
}

console.log("\nMessenger — the conversation half of flows 1 and 3");
await pageCall(
  "GET /{page}/conversations",
  "pages_messaging",
  `/${page.id}/conversations?fields=id,updated_time,participants&limit=5`,
);

console.log("\nWebhook subscription state");
await pageCall(
  "GET /{page}/subscribed_apps",
  "pages_manage_metadata",
  `/${page.id}/subscribed_apps`,
);

if (SUBSCRIBE) {
  // The only write in the script, and it is opt-in. It subscribes THIS Page to
  // THIS app's webhook — which is the step the app dashboard shows as missing,
  // and the reason nothing inbound can arrive today.
  console.log("\nSubscribing the Page to this app's webhook (--subscribe)");
  await pageCall(
    "POST /{page}/subscribed_apps",
    "pages_manage_metadata",
    `/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed,leadgen`,
    { method: "POST" },
  );
}

console.log("\nLead forms — flows 2 and 4");
// One call, two permissions: the edge needs `pages_manage_ads` to be reachable
// and `leads_retrieval` to return anything. A success counts for both.
const forms = await pageCall(
  "GET /{page}/leadgen_forms",
  "leads_retrieval",
  `/${page.id}/leadgen_forms?fields=id,name,status&limit=5`,
);
if (forms) results.push({ permission: "pages_manage_ads", label: "leadgen_forms", ok: true });
else if (!DRY_RUN) {
  results.push({
    permission: "pages_manage_ads",
    label: "leadgen_forms",
    ok: false,
    error: "the same call that exercises leads_retrieval",
  });
}

console.log("\nInstagram");
const igId = page.instagram_business_account?.id ?? null;

if (!igId) {
  console.log(
    "  SKIP instagram_basic / instagram_manage_messages\n" +
      "       This Page has no Instagram professional account linked. Link one in\n" +
      "       Meta Business Suite, or the Instagram half of the product cannot be\n" +
      "       reviewed or used.",
  );
  results.push({ permission: "instagram_basic", label: "no linked IG account", ok: false });
  results.push({
    permission: "instagram_manage_messages",
    label: "no linked IG account",
    ok: false,
  });
} else {
  await pageCall(
    "GET /{ig}?fields=username",
    "instagram_basic",
    `/${igId}?fields=id,username,followers_count`,
  );
  await pageCall(
    "GET /{ig}/media  (comments we may privately reply to)",
    "instagram_basic",
    `/${igId}/media?fields=id,permalink,timestamp,comments{id,text,username,timestamp}&limit=5`,
  );
  // Via the **Page** id with `platform=instagram`, not the Instagram user id.
  // This is the Messenger Platform route, where the Page is the actor.
  // `/{ig-user-id}/conversations` returns `(#3) Application does not have the
  // capability` — that endpoint belongs to the Instagram-login route, which
  // uses different permissions and a different token.
  await pageCall(
    "GET /{page}/conversations?platform=instagram",
    "instagram_manage_messages",
    `/${page.id}/conversations?platform=instagram&fields=id,updated_time&limit=5`,
  );
}

console.log("\nBusiness");
const businesses = await call(
  "GET /me/businesses",
  "business_management",
  "/me/businesses?fields=id,name&limit=5",
) ?? (DRY_RUN ? { data: [{ id: "{business-id}", name: "(dry run)" }] } : null);

if (WHATSAPP) {
  console.log("\nWhatsApp (--whatsapp: only needed if going direct to Meta's Cloud API)");
  const allBusinesses = businesses?.data ?? [];

  if (allBusinesses.length === 0) {
    console.log(
      "  SKIP whatsapp_*\n" +
        "       No Business came back, and a WhatsApp Business Account hangs off one.\n" +
        "       Business Verification is a prerequisite for WhatsApp anyway.",
    );
    for (const scope of WHATSAPP_SCOPES) {
      results.push({ permission: scope, label: "no business", ok: false });
    }
  } else {
    // Every Business, not just the first: a WhatsApp account lives on exactly
    // one of them, and picking arbitrarily reports "none" for an account that
    // is plainly there.
    let waba = null;
    for (const business of allBusinesses) {
      const waAccounts = await call(
        `GET /${business.name}/owned_whatsapp_business_accounts`,
        "whatsapp_business_management",
        `/${business.id}/owned_whatsapp_business_accounts?fields=id,name&limit=5`,
      );
      const found = waAccounts?.data?.[0]?.id ?? null;
      if (found) {
        waba = found;
        break;
      }
    }
    if (!waba && !DRY_RUN) {
      console.log(
        "  SKIP whatsapp_business_messaging\n" +
          "       No WhatsApp Business Account on this Business yet. Create one in\n" +
          "       Business Settings → WhatsApp Accounts before this can be exercised.",
      );
      results.push({
        permission: "whatsapp_business_messaging",
        label: "no WhatsApp Business Account",
        ok: false,
      });
    } else {
      // A read of the registered numbers. Deliberately not a send: a WhatsApp
      // message to a real person to tick a review checkbox is not a test, it is
      // an unsolicited message.
      await call(
        "GET /{waba}/phone_numbers",
        "whatsapp_business_messaging",
        `/${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=5`,
      );
    }
  }
}

/* --------------------------------------------------------------- summary */

const byPermission = new Map();
for (const r of results) {
  const prev = byPermission.get(r.permission);
  // One success is enough for the counter; keep it over a later failure.
  if (!prev || (prev.ok !== true && r.ok === true)) byPermission.set(r.permission, r);
}

console.log("\n" + "=".repeat(72));
console.log("Per-permission result — this is what the dashboard counters read from");
console.log("=".repeat(72));

let missing = 0;
for (const scope of SCOPES) {
  const r = byPermission.get(scope);
  const mark = r?.ok === true ? "  ✓" : r?.ok === null ? "  ·" : "  ✗";
  console.log(`${mark} ${scope.padEnd(30)} ${r?.ok === true ? "call succeeded" : (r?.error ?? "not exercised")}`);
  if (r?.ok !== true && !DRY_RUN) missing += 1;
}

console.log(
  `\n${missing === 0 ? "All required permissions exercised." : `${missing} permission(s) still need a successful call.`}`,
);
console.log(
  "Meta takes up to 24 hours to show these, and each test is valid for 30 days.\n",
);

process.exit(missing === 0 ? 0 : 1);
