/**
 * Provisions the account Meta's App Review team signs in with.
 *
 *   node scripts/provision-meta-reviewer.mjs
 *
 * A reviewer has to reach Settings -> Connections and see a Page that is
 * actually connected. Three ways to give them that, and only one is right:
 *
 *   - Hand over the owner's own login. No: it puts a real person's password
 *     into a third party's ticketing system, and a reviewer poking around a
 *     live workspace can change real data.
 *   - A brand-new workspace of its own. Honest, but empty - no Page, no leads,
 *     no conversations - so every clip shows an empty state and the reviewer
 *     concludes the integration does not work.
 *   - A dedicated account added as a member of the workspace that already has
 *     the Page connected. That is this script.
 *
 * Both a `profiles` row and a `business_members` row are written, because
 * `auth/access.ts::hasGrantedAccess` accepts either and the app is invite-only:
 * without one of them the callback signs the reviewer straight back out with
 * `?error=invite_only`, which looks exactly like a broken login.
 *
 * Safe to re-run: an existing account has its password reset rather than being
 * duplicated, so the credentials in the submission can always be made true
 * again without touching anything else.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env","utf8").split(/\r?\n/)
  .filter(l=>l && !l.startsWith("#") && l.includes("="))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const BIZ   = "7c7f61e4-ee71-42ef-b81a-2bd31f84a50b";
const EMAIL = "meta-reviewer@clientturn.com";
const PASS  = "MetaReview!2026-CT";

// Reuse the account if a previous run made one, so this is safe to re-run.
const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = list.users.find(u => u.email === EMAIL);

if (!user) {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL, password: PASS, email_confirm: true,
    user_metadata: { first_name: "Meta", last_name: "Reviewer" },
  });
  if (error) { console.log("createUser ERROR:", error.message); process.exit(1); }
  user = data.user;
  console.log("created auth user", user.id);
} else {
  const { error } = await db.auth.admin.updateUserById(user.id, { password: PASS, email_confirm: true });
  console.log(error ? "updateUser ERROR: " + error.message : "reset password on existing user " + user.id);
}

// hasGrantedAccess() looks for a profile OR a membership. Both are written:
// the profile so the invite-only gate opens, the membership so the reviewer
// lands in the workspace that actually has a Page connected.
const p = await db.from("profiles").upsert({
  id: user.id, email: EMAIL, first_name: "Meta", last_name: "Reviewer",
}, { onConflict: "id" });
console.log("profile:", p.error ? p.error.message : "ok");

const existing = await db.from("business_members").select("id").eq("business_id", BIZ).eq("user_id", user.id).maybeSingle();
if (!existing.data) {
  const m = await db.from("business_members").insert({
    business_id: BIZ, user_id: user.id, role: "admin", status: "active",
    invited_email: EMAIL, accepted_at: new Date().toISOString(),
  });
  console.log("membership:", m.error ? m.error.message : "added as admin");
} else {
  console.log("membership: already present");
}

console.log(`\nREVIEWER LOGIN\n  ${EMAIL}\n  ${PASS}`);
