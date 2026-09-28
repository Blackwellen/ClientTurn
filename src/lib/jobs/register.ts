import "server-only";
import { registerHandler } from "./registry";
import { handleLeadProcess } from "./handlers/lead-process";
import { handleLeadScore } from "./handlers/lead-score";
import { handleMessageSend } from "./handlers/message-send";
import { handleMessageProcessInbound } from "./handlers/message-inbound";
import { handleEmailPoll } from "./handlers/email-poll";
import { handleAutomationAdvance } from "./handlers/automation-advance";
import { handleCampaignExpand } from "./handlers/campaign-expand";
import { handleCampaignSend } from "./handlers/campaign-send";
import { handleBookingSync } from "./handlers/booking-sync";
import { handleIntegrationHealthCheck } from "./handlers/integration-health";
import { handleWebhookReplay } from "./handlers/webhook-replay";
import { handleWebhookDispatch } from "./handlers/webhook-dispatch";
import { handleNotificationSend } from "./handlers/notification-send";
import { handleUsageAggregate } from "./handlers/usage-aggregate";
import { handleRetentionCleanup } from "./handlers/retention-cleanup";
import { handleCostRollupDaily, handleCostRollupMonthly } from "./handlers/cost-rollup";
import { handleLeadSourcePoll } from "./handlers/lead-source-poll";
import { handleCrmPush } from "./handlers/crm-push";
import { handleNotificationSlack } from "./handlers/notification-slack";
import { handleSlackDigest } from "./handlers/slack-digest";
import { handleSlackInteraction } from "./handlers/slack-interaction";
import { handleMaintenanceExpiry } from "./handlers/maintenance";
import { handleAgentRun } from "./handlers/agent-run";
import { handleSourcingRun } from "./handlers/sourcing-run";
import { handleBusinessAnalyse } from "./handlers/business-analyse";
import { handleRecurringSearchTick } from "./handlers/recurring-search";
import { handleOutreachDispatch } from "./handlers/outreach-dispatch";
import { handleOutreachTick } from "./handlers/outreach-tick";
import { handleOutreachAudience } from "./handlers/outreach-audience";
import { handleOutreachOptimize } from "./handlers/outreach-optimize";
import { handleAppIngest } from "./handlers/app-ingest";
import { handleAffiliateLedger } from "./handlers/affiliate-ledger";
import { handleAffiliateBillingEvent } from "./handlers/affiliate-billing-event";
import { handleSocialTick, handleSocialAdvance } from "./handlers/social-tick";
import { handleSocialExecute } from "./handlers/social-execute";
import { handleIngestWebhook } from "./handlers/ingest-webhook";
import { handleEventDispatch } from "@/lib/events/outbox";
import { handleHandoffBrief } from "./handlers/handoff-brief";
import { handleDomainHealthCheck } from "./handlers/domain-health";
import { handleCrmPull } from "./handlers/crm-pull";
import { handleSenderHealth } from "./handlers/sender-health";
import { handleWhatsAppTemplateSync } from "./handlers/whatsapp-template-sync";
import { handleBillingDaily } from "./handlers/billing-daily";
import { handleBillingRefundReverse } from "./handlers/billing-refund";
import { handleIntentSweep } from "./handlers/intent-sweep";
import { handlePaymentConfirm } from "./handlers/payment-confirm";
import { handleCheckoutNudge } from "./handlers/checkout-nudge";
import { handleEconomicsMarginCheck } from "./handlers/economics-margin-check";
import { handleReengageSweep, handleReengageTrigger } from "./handlers/reengage";
import {
  handleVoiceDial,
  handleVoiceNumberProvision,
  handleVoiceNumberRelease,
  handleVoicePostCall,
  handleVoiceRecordingFetch,
  handleVoiceRetry,
  handleVoiceTextBack,
  handleVoiceWebhookIngest,
} from "./handlers/voice";
import { handleExperimentAutoPromote, handleVoiceMarginCheck } from "./handlers/daily-voice-and-experiments";
import { handleQuoteExpire, handleQuoteNudge, handleQuoteRenderPdf } from "./handlers/quote-jobs";
import { handleInvoiceIssue, handleInvoiceRemind } from "./handlers/invoice-jobs";
import { handleAutomationDispatch } from "@/lib/automation/rule-runner";
import { handleVoiceRetention } from "./handlers/voice-retention";
import { handleWorkspaceDeletion } from "./handlers/workspace-deletion";
// The provider adapters, which register themselves on import. One list, in
// `providers/all`, so a new adapter reaches the OAuth routes and the queue
// together rather than only whichever one its author remembered.
import "@/lib/integrations/providers/all";

let registered = false;

/**
 * Every member of JobType is registered here. Importing this module for its
 * side effects is what makes the queue do anything at all; the guard keeps a
 * repeated import in a warm serverless instance harmless.
 */
export function registerJobHandlers() {
  if (registered) return;
  registered = true;

  registerHandler("affiliate.ledger", handleAffiliateLedger);
  registerHandler("affiliate.billing_event", handleAffiliateBillingEvent);
  registerHandler("lead.process", handleLeadProcess);
  registerHandler("handoff.brief", handleHandoffBrief);
  registerHandler("domain.health_check", handleDomainHealthCheck);
  registerHandler("crm.pull", handleCrmPull);
  registerHandler("email.sender_health", handleSenderHealth);
  registerHandler("whatsapp.template_sync", handleWhatsAppTemplateSync);
  registerHandler("billing.daily", handleBillingDaily);
  registerHandler("billing.refund_reverse", handleBillingRefundReverse);
  registerHandler("lead.score", handleLeadScore);
  registerHandler("intent.sweep", handleIntentSweep);
  registerHandler("reengage.trigger", handleReengageTrigger);
  registerHandler("reengage.sweep", handleReengageSweep);
  registerHandler("quote.render_pdf", handleQuoteRenderPdf);
  registerHandler("quote.expire", handleQuoteExpire);
  registerHandler("quote.nudge", handleQuoteNudge);
  registerHandler("invoice.issue", handleInvoiceIssue);
  registerHandler("invoice.remind", handleInvoiceRemind);
  registerHandler("payment.confirm", handlePaymentConfirm);
  registerHandler("checkout.nudge", handleCheckoutNudge);
  registerHandler("economics.margin_check", handleEconomicsMarginCheck);
  registerHandler("message.send", handleMessageSend);
  registerHandler("message.process_inbound", handleMessageProcessInbound);
  registerHandler("email.poll", handleEmailPoll);
  registerHandler("automation.advance", handleAutomationAdvance);
  registerHandler("campaign.expand", handleCampaignExpand);
  registerHandler("campaign.send", handleCampaignSend);
  registerHandler("booking.sync", handleBookingSync);
  registerHandler("integration.health_check", handleIntegrationHealthCheck);
  registerHandler("webhook.replay", handleWebhookReplay);
  registerHandler("webhook.dispatch", handleWebhookDispatch);
  registerHandler("notification.send", handleNotificationSend);
  registerHandler("usage.aggregate", handleUsageAggregate);
  registerHandler("retention.cleanup", handleRetentionCleanup);
  registerHandler("cost.rollup_daily", handleCostRollupDaily);
  registerHandler("cost.rollup_monthly", handleCostRollupMonthly);
  registerHandler("lead_source.poll", handleLeadSourcePoll);
  registerHandler("crm.push", handleCrmPush);
  registerHandler("notification.slack", handleNotificationSlack);
  registerHandler("notification.slack_digest", handleSlackDigest);
  registerHandler("slack.interaction", handleSlackInteraction);
  registerHandler("maintenance.expiry", handleMaintenanceExpiry);
  registerHandler("agent.run", handleAgentRun);
  registerHandler("sourcing.run", handleSourcingRun);
  registerHandler("business.analyse", handleBusinessAnalyse);
  registerHandler("recurring_search.tick", handleRecurringSearchTick);
  registerHandler("outreach.dispatch", handleOutreachDispatch);
  registerHandler("outreach.tick", handleOutreachTick);
  registerHandler("outreach.audience", handleOutreachAudience);
  registerHandler("outreach.optimize", handleOutreachOptimize);
  registerHandler("app.ingest", handleAppIngest);
  registerHandler("social.tick", handleSocialTick);
  registerHandler("social.advance", handleSocialAdvance);
  registerHandler("social.execute", handleSocialExecute);
  registerHandler("event.dispatch", handleEventDispatch);
  registerHandler("ingest.webhook", handleIngestWebhook);
  registerHandler("voice.dial", handleVoiceDial);
  registerHandler("voice.webhook_ingest", handleVoiceWebhookIngest);
  registerHandler("voice.post_call", handleVoicePostCall);
  registerHandler("voice.recording_fetch", handleVoiceRecordingFetch);
  registerHandler("voice.retry", handleVoiceRetry);
  registerHandler("voice.number_provision", handleVoiceNumberProvision);
  registerHandler("voice.number_release", handleVoiceNumberRelease);
  registerHandler("voice.text_back", handleVoiceTextBack);
  registerHandler("voice.margin_check", handleVoiceMarginCheck);
  registerHandler("experiment.auto_promote", handleExperimentAutoPromote);
  registerHandler("automation.dispatch", handleAutomationDispatch);
  registerHandler("voice.retention", handleVoiceRetention);
  registerHandler("billing.workspace_deletion", handleWorkspaceDeletion);
}

registerJobHandlers();
