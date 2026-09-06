import "server-only";
import { registerHandler } from "./registry";
import { handleLeadProcess } from "./handlers/lead-process";
import { handleMessageSend } from "./handlers/message-send";
import { handleMessageProcessInbound } from "./handlers/message-inbound";
import { handleEmailPoll } from "./handlers/email-poll";
import { handleAutomationAdvance } from "./handlers/automation-advance";
import { handleCampaignExpand } from "./handlers/campaign-expand";
import { handleCampaignSend } from "./handlers/campaign-send";
import { handleBookingSync } from "./handlers/booking-sync";
import { handleIntegrationHealthCheck } from "./handlers/integration-health";
import { handleWebhookReplay } from "./handlers/webhook-replay";
import { handleNotificationSend } from "./handlers/notification-send";
import { handleUsageAggregate } from "./handlers/usage-aggregate";
import { handleRetentionCleanup } from "./handlers/retention-cleanup";
import { handleCostRollupDaily, handleCostRollupMonthly } from "./handlers/cost-rollup";
import { handleLeadSourcePoll } from "./handlers/lead-source-poll";
import { handleCrmPush } from "./handlers/crm-push";
import { handleNotificationSlack } from "./handlers/notification-slack";
import { handleAgentRun } from "./handlers/agent-run";
import { handleSourcingRun } from "./handlers/sourcing-run";
import { handleBusinessAnalyse } from "./handlers/business-analyse";
import { handleRecurringSearchTick } from "./handlers/recurring-search";
import { handleAppIngest } from "./handlers/app-ingest";
import "@/lib/integrations/providers/google-ads";
import "@/lib/integrations/providers/microsoft-ads";
import "@/lib/integrations/providers/tiktok-ads";
import "@/lib/integrations/providers/linkedin-ads";
import "@/lib/integrations/providers/slack";
import "@/lib/integrations/providers/hubspot";
import "@/lib/integrations/providers/zoho-crm";

let registered = false;

/**
 * Every member of JobType is registered here. Importing this module for its
 * side effects is what makes the queue do anything at all; the guard keeps a
 * repeated import in a warm serverless instance harmless.
 */
export function registerJobHandlers() {
  if (registered) return;
  registered = true;

  registerHandler("lead.process", handleLeadProcess);
  registerHandler("message.send", handleMessageSend);
  registerHandler("message.process_inbound", handleMessageProcessInbound);
  registerHandler("email.poll", handleEmailPoll);
  registerHandler("automation.advance", handleAutomationAdvance);
  registerHandler("campaign.expand", handleCampaignExpand);
  registerHandler("campaign.send", handleCampaignSend);
  registerHandler("booking.sync", handleBookingSync);
  registerHandler("integration.health_check", handleIntegrationHealthCheck);
  registerHandler("webhook.replay", handleWebhookReplay);
  registerHandler("notification.send", handleNotificationSend);
  registerHandler("usage.aggregate", handleUsageAggregate);
  registerHandler("retention.cleanup", handleRetentionCleanup);
  registerHandler("cost.rollup_daily", handleCostRollupDaily);
  registerHandler("cost.rollup_monthly", handleCostRollupMonthly);
  registerHandler("lead_source.poll", handleLeadSourcePoll);
  registerHandler("crm.push", handleCrmPush);
  registerHandler("notification.slack", handleNotificationSlack);
  registerHandler("agent.run", handleAgentRun);
  registerHandler("sourcing.run", handleSourcingRun);
  registerHandler("business.analyse", handleBusinessAnalyse);
  registerHandler("recurring_search.tick", handleRecurringSearchTick);
  registerHandler("app.ingest", handleAppIngest);
}

registerJobHandlers();
