import { test } from "node:test";
import assert from "node:assert/strict";
import { channelUsable } from "../src/lib/integrations/platform-channels.ts";
import { campaignChannelReadiness } from "../src/lib/campaigns/reactivation-channels.ts";

test("with no workspace row, the platform sender decides", () => {
  assert.equal(channelUsable([], ["twilio_sms"], true), true);
  assert.equal(channelUsable([], ["twilio_sms"], false), false);
});

test("a workspace's own row decides when it exists", () => {
  assert.equal(channelUsable([{ provider_type: "twilio_sms", status: "HEALTHY" }], ["twilio_sms"], false), true);
  assert.equal(channelUsable([{ provider_type: "twilio_sms", status: "DEGRADED" }], ["twilio_sms"], false), true);
  // A disconnected own row is not rescued by the platform sender.
  assert.equal(channelUsable([{ provider_type: "twilio_sms", status: "DISCONNECTED" }], ["twilio_sms"], true), false);
  // Rows for other providers are ignored.
  assert.equal(channelUsable([{ provider_type: "imap_smtp", status: "HEALTHY" }], ["twilio_sms"], true), true);
});

test("reactivation SMS is ready on the platform sender with no row", () => {
  const ready = campaignChannelReadiness([], { sms: true, whatsapp: false });
  assert.equal(ready.sms, true);
  assert.equal(ready.whatsapp, false);
  assert.equal(ready.email, false);
  // Email still needs the workspace's own mailbox.
  assert.equal(campaignChannelReadiness([{ provider_type: "imap_smtp", status: "HEALTHY" }]).email, true);
  // Without the platform flag (the old call shape) nothing changes for rows.
  assert.equal(campaignChannelReadiness([{ provider_type: "twilio_sms", status: "HEALTHY" }]).sms, true);
});
