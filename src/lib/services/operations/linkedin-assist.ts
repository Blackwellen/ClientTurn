import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { suppress } from "@/lib/policy/suppression";
import { isOptOutPhrase } from "@/lib/agent/classification";
import { isOptOutKeyword, socialAddress } from "@/lib/messaging/types";
import { enqueueAgentTurn, inboundMessageEvent } from "@/lib/agent/events";
import { ingestSocialReply } from "@/lib/social/replies";
import { isSuppressed, loadBusinessContext, stopAutomationRuns } from "@/lib/jobs/handlers/shared";
import {
  addContactSchema,
  canSnooze,
  channelMoves,
  CONNECTION_NOTE_MAX_CHARS,
  linkedInAssistSettingsSchema,
  localDate,
  addDays,
  linkedInThreadKey,
  logReplySchema,
  markSentSchema,
  moveChannelSchema,
  MOVE_STOP_REASON,
  normaliseLinkedInProfileUrl,
  onMarkSent,
  onSkip,
  stopReasonFor,
  STOP_REASON_LABEL,
  taskIdSchema,
  type LinkedInStopReason,
} from "@/lib/linkedin-assist/types";
import { templateDraft } from "@/lib/linkedin-assist/compose";
import {
  cancelOpenTasks,
  db,
  draftBusiness,
  draftTask,
  enqueueDraft,
  ensureLinkedInConversation,
  latestAgentDraft,
  loadContact,
  loadSettings,
  loadTask,
  scheduleTask,
  setContactState,
  subjectFor,
  CONTACT_COLUMNS,
  type ContactRow,
  type TaskRow,
} from "@/lib/linkedin-assist/store";
import { roleMeets, type ServiceContext } from "../types";
import { defineOperation, ServiceError } from "../runtime";

/**
 * LinkedIn Assist (owner decision 2026-09-28): the AI drafts; a person sends.
 *
 * Every operation here records what a person did on their own LinkedIn
 * account, or plans what they will do. None of them touches LinkedIn. The
 * stop conditions (opt-out, replied, won/lost) are re-checked immediately
 * before every action from live state, never from when the task was planned.
 */

/* ---------------------------------------------------------------- helpers */

async function workspaceTimezone(businessId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  return data?.timezone || "Europe/London";
}

function requireUser(context: ServiceContext): string {
  if (!context.userId) throw new ServiceError("FORBIDDEN_ROLE", "LinkedIn Assist is a person's own list.");
  return context.userId;
}

/** A task is its assignee's; an admin may act on a teammate's list. */
async function ownTask(context: ServiceContext, taskId: string): Promise<TaskRow> {
  const userId = requireUser(context);
  const task = await loadTask(context.businessId, taskId);
  if (!task) throw new ServiceError("NOT_FOUND", "That task could not be found.");
  if (task.assignee_user_id !== userId && !roleMeets(context.role, "admin")) {
    throw new ServiceError("FORBIDDEN_ROLE", "That task is on a teammate's list.");
  }
  return task;
}

async function contactFor(task: TaskRow): Promise<ContactRow> {
  const contact = await loadContact(task.business_id, task.contact_id);
  if (!contact) throw new ServiceError("NOT_FOUND", "That contact is no longer on LinkedIn Assist.");
  return contact;
}

/** Re-checks the stop conditions; a stopped task is cancelled and refused. */
async function assertActionable(task: TaskRow, contact: ContactRow) {
  if (task.status !== "OPEN") {
    throw new ServiceError("CONFLICT", "That task has already been completed.");
  }
  const subject = await subjectFor(contact);
  if (!subject) throw new ServiceError("NOT_FOUND", "That lead or prospect no longer exists.");
  const reason = stopReasonFor(task.kind, {
    contactState: contact.state,
    optedOut: subject.optedOut || contact.stopped_reason === "OPTED_OUT",
    leadStatus: subject.leadStatus,
  });
  if (reason) {
    const label =
      reason === "REPLIED"
        ? "They replied, so the outreach stopped."
        : reason === "FINISHED"
          ? "This sequence has finished."
          : STOP_REASON_LABEL[reason];
    await db()
      .from("linkedin_assist_tasks")
      .update({ status: "CANCELLED", cancelled_reason: label })
      .eq("business_id", task.business_id)
      .eq("id", task.id)
      .eq("status", "OPEN");
    if (reason === "OPTED_OUT" && contact.state !== "STOPPED") {
      await setContactState(task.business_id, contact.id, {
        state: "STOPPED",
        stopped_reason: "OPTED_OUT",
        stopped_at: new Date().toISOString(),
      });
    }
    throw new ServiceError("POLICY_BLOCKED", `${label} This task has been removed from your list.`);
  }
  return subject;
}

/** Puts a sent LinkedIn message on the lead's conversation, so it shows on the timeline and in the Inbox. */
async function recordOutbound(contact: ContactRow, body: string, now: string): Promise<void> {
  if (!contact.lead_id || !body.trim()) return;
  const conversationId = await ensureLinkedInConversation(contact);
  if (!conversationId) return;
  const { error } = await db().from("messages").insert({
    business_id: contact.business_id,
    conversation_id: conversationId,
    lead_id: contact.lead_id,
    direction: "outbound",
    channel: "linkedin",
    body,
    status: "SENT",
    origin: "manual",
    provider: "linkedin_assist",
    sent_at: now,
  });
  if (error) throw error;
  await db()
    .from("conversations")
    .update({ last_outbound_at: now, last_message_at: now })
    .eq("business_id", contact.business_id)
    .eq("id", conversationId);
}

/* ================================================================ add */

defineOperation("linkedin_assist.add_contact", {
  schema: addContactSchema,
  async run({ args, context }) {
    const userId = requireUser(context);
    const profileUrl = normaliseLinkedInProfileUrl(args.profileUrl)!;

    const { settings } = await loadSettings(context.businessId, userId);
    if (args.firstTouch === "INMAIL" && settings.monthlyInMailCredits === 0) {
      throw new ServiceError(
        "INVALID_INPUT",
        "InMail needs LinkedIn Premium or Sales Navigator credits. Set how many you have in LinkedIn Assist settings, or send a connection request instead.",
      );
    }

    const subject = await subjectFor({
      business_id: context.businessId,
      lead_id: args.leadId ?? null,
      prospect_id: args.prospectId ?? null,
    });
    if (!subject) throw new ServiceError("NOT_FOUND", "That lead or prospect could not be found.");
    if (subject.optedOut) {
      throw new ServiceError("POLICY_BLOCKED", "They asked not to be contacted, so they cannot be added.");
    }
    if (subject.leadStatus === "WON" || subject.leadStatus === "LOST") {
      throw new ServiceError("POLICY_BLOCKED", "This lead is already closed.");
    }

    const { data, error } = await db()
      .from("linkedin_assist_contacts")
      .insert({
        business_id: context.businessId,
        owner_user_id: userId,
        lead_id: args.leadId ?? null,
        prospect_id: args.prospectId ?? null,
        profile_url: profileUrl,
        first_touch: args.firstTouch,
      })
      .select(CONTACT_COLUMNS)
      .maybeSingle();
    if (error?.code === "23505") {
      throw new ServiceError("CONFLICT", "They are already on LinkedIn Assist.");
    }
    if (error || !data) throw error ?? new Error("contact not created");
    const contact = data as ContactRow;

    const today = localDate(new Date(), await workspaceTimezone(context.businessId));
    const taskId = await scheduleTask(contact, {
      kind: args.firstTouch,
      step: 1,
      dueOn: today,
      dedupeKey: `first:${contact.id}`,
    });
    // The template goes in now so the task is usable at once; the job
    // improves it with AI where the workspace and plan allow.
    if (taskId) {
      await draftTaskTemplateOnly(context.businessId, taskId);
      await enqueueDraft(context.businessId, taskId);
    }

    return {
      data: { contactId: contact.id, taskId },
      entityId: contact.id,
      after: { profileUrl, firstTouch: args.firstTouch, leadId: contact.lead_id, prospectId: contact.prospect_id },
    };
  },
});

/** The template draft, written synchronously so a new task is never empty. */
async function draftTaskTemplateOnly(businessId: string, taskId: string) {
  const task = await loadTask(businessId, taskId);
  if (!task || task.body) return;
  const contact = await loadContact(businessId, task.contact_id);
  if (!contact) return;
  const subject = await subjectFor(contact);
  if (!subject || task.kind === "REPLY") return;
  const { business } = await draftBusiness(businessId);
  await db()
    .from("linkedin_assist_tasks")
    .update({ body: templateDraft(task.kind, task.step, subject.draft, business), body_source: "TEMPLATE" })
    .eq("business_id", businessId)
    .eq("id", taskId)
    .is("body", null);
}

/* ================================================================ redraft */

defineOperation("linkedin_assist.redraft", {
  schema: taskIdSchema,
  async run({ args, context }) {
    const task = await ownTask(context, args.taskId);
    if (task.kind === "REPLY") {
      throw new ServiceError("INVALID_INPUT", "Replies are drafted by the assistant from the conversation.");
    }
    await assertActionable(task, await contactFor(task));
    const result = await draftTask(context.businessId, task.id, { force: true });
    return { data: result, entityId: task.id };
  },
});

/* ================================================================ mark sent */

defineOperation("linkedin_assist.mark_sent", {
  schema: markSentSchema,
  async run({ args, context }) {
    const userId = requireUser(context);
    const task = await ownTask(context, args.taskId);
    const contact = await contactFor(task);
    await assertActionable(task, contact);

    const now = new Date().toISOString();
    const tz = await workspaceTimezone(context.businessId);
    const today = localDate(new Date(), tz);

    // What was actually sent.
    let draft: { id: string; body: string } | null = null;
    if (task.kind === "REPLY" && contact.conversation_id) {
      draft = await latestAgentDraft(context.businessId, contact.conversation_id, task.created_at);
    }
    const withoutNote = task.kind === "CONNECTION_NOTE" && args.withoutNote === true;
    const sentBody = withoutNote ? null : (args.body?.trim() || draft?.body || task.body || "").trim() || null;

    if (task.kind !== "CONNECTION_NOTE" && !sentBody) {
      throw new ServiceError("INVALID_INPUT", "Add the message you sent first.");
    }
    if (task.kind === "CONNECTION_NOTE" && sentBody && sentBody.length > CONNECTION_NOTE_MAX_CHARS) {
      throw new ServiceError("INVALID_INPUT", `A connection note can be at most ${CONNECTION_NOTE_MAX_CHARS} characters.`);
    }
    const edited = Boolean(args.body?.trim()) && args.body!.trim() !== (draft?.body ?? task.body ?? "").trim();

    const { data: updated, error } = await db()
      .from("linkedin_assist_tasks")
      .update({
        status: "SENT",
        completed_at: now,
        completed_by: userId,
        body: sentBody,
        body_source: edited ? "PERSON" : task.kind === "REPLY" && draft ? "AGENT" : task.body_source,
        draft_message_id: draft?.id ?? task.draft_message_id,
      })
      .eq("business_id", context.businessId)
      .eq("id", task.id)
      .eq("status", "OPEN")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new ServiceError("CONFLICT", "That task has already been completed.");

    // The transcript: an approved agent draft becomes the sent message;
    // otherwise the words sent are recorded as a new outbound message.
    if (task.kind === "REPLY" && draft) {
      await db()
        .from("messages")
        .update({ status: "SENT", body: sentBody, origin: "manual", provider: "linkedin_assist", sent_at: now, scheduled_for: null })
        .eq("business_id", context.businessId)
        .eq("id", draft.id)
        .eq("status", "DRAFT");
    } else if (sentBody) {
      await recordOutbound(contact, sentBody, now);
    }

    const { settings } = await loadSettings(context.businessId, contact.owner_user_id);
    const outcome = onMarkSent({
      contactId: contact.id,
      kind: task.kind,
      step: task.step,
      today,
      settings,
      currentState: contact.state,
    });
    const statePatch: Record<string, unknown> = { state: outcome.finished ? "FINISHED" : outcome.nextState };
    if (task.kind === "CONNECTION_NOTE") statePatch.invited_at = now;
    if (task.kind === "FOLLOW_UP" || task.kind === "INMAIL") statePatch.messaged_at = now;
    if (outcome.finished) statePatch.stopped_reason = "NO_RESPONSE";
    await setContactState(context.businessId, contact.id, statePatch);

    let nextTaskId: string | null = null;
    if (outcome.next) {
      nextTaskId = await scheduleTask(contact, outcome.next);
      if (nextTaskId) {
        await draftTaskTemplateOnly(context.businessId, nextTaskId);
        await enqueueDraft(context.businessId, nextTaskId);
      }
    }

    return {
      data: { nextDueOn: outcome.next?.dueOn ?? null, nextTaskId, finished: outcome.finished },
      entityId: task.id,
      before: { status: "OPEN" },
      after: { status: "SENT", kind: task.kind, step: task.step, withoutNote },
    };
  },
});

/* ================================================================ skip */

defineOperation("linkedin_assist.skip", {
  schema: taskIdSchema,
  async run({ args, context }) {
    const task = await ownTask(context, args.taskId);
    if (task.status !== "OPEN") throw new ServiceError("CONFLICT", "That task has already been completed.");
    const contact = await contactFor(task);
    const today = localDate(new Date(), await workspaceTimezone(context.businessId));
    const { settings } = await loadSettings(context.businessId, contact.owner_user_id);

    const { error } = await db()
      .from("linkedin_assist_tasks")
      .update({ status: "SKIPPED", completed_at: new Date().toISOString(), completed_by: context.userId })
      .eq("business_id", context.businessId)
      .eq("id", task.id)
      .eq("status", "OPEN");
    if (error) throw error;

    if (task.kind === "REPLY" && contact.conversation_id) {
      const draft = await latestAgentDraft(context.businessId, contact.conversation_id, task.created_at);
      if (draft) {
        await db()
          .from("messages")
          .update({ status: "DISCARDED" })
          .eq("business_id", context.businessId)
          .eq("id", draft.id)
          .eq("status", "DRAFT");
      }
    }

    const outcome = onSkip({ contactId: contact.id, kind: task.kind, step: task.step, today, settings });
    if (outcome.next) {
      const nextId = await scheduleTask(contact, outcome.next);
      if (nextId) {
        await draftTaskTemplateOnly(context.businessId, nextId);
        await enqueueDraft(context.businessId, nextId);
      }
    } else if (outcome.stop) {
      await setContactState(context.businessId, contact.id, {
        state: outcome.stop === "NO_RESPONSE" ? "FINISHED" : "STOPPED",
        stopped_reason: outcome.stop,
        stopped_at: new Date().toISOString(),
      });
    }
    return { data: { nextDueOn: outcome.next?.dueOn ?? null }, entityId: task.id, after: { status: "SKIPPED" } };
  },
});

/* ================================================================ snooze */

defineOperation("linkedin_assist.snooze", {
  schema: taskIdSchema,
  async run({ args, context }) {
    const task = await ownTask(context, args.taskId);
    await assertActionable(task, await contactFor(task));
    if (!canSnooze(task.kind, task.step, task.snooze_count)) {
      throw new ServiceError("INVALID_INPUT", "This one cannot be put off again. Skip it if they have not accepted.");
    }
    const today = localDate(new Date(), await workspaceTimezone(context.businessId));
    const { settings } = await loadSettings(context.businessId, task.assignee_user_id);
    const dueOn = addDays(today, settings.followUpAfterDays);
    const { error } = await db()
      .from("linkedin_assist_tasks")
      .update({ due_on: dueOn, snooze_count: task.snooze_count + 1 })
      .eq("business_id", context.businessId)
      .eq("id", task.id)
      .eq("status", "OPEN");
    if (error) throw error;
    return { data: { dueOn }, entityId: task.id, after: { dueOn } };
  },
});

/* ================================================================ log reply */

type LogReplyData = {
  optedOut: boolean;
  replyTaskId: string | null;
  classification?: string | null;
  agentDrafting?: boolean;
};

defineOperation<z.infer<typeof logReplySchema>, LogReplyData>("linkedin_assist.log_reply", {
  schema: logReplySchema,
  async run({ args, context }) {
    const userId = requireUser(context);
    const task = await ownTask(context, args.taskId);
    let contact = await contactFor(task);
    const subject = await subjectFor(contact);
    if (!subject) throw new ServiceError("NOT_FOUND", "That lead or prospect no longer exists.");

    const body = args.body.trim();
    const now = new Date().toISOString();
    const today = localDate(new Date(), await workspaceTimezone(context.businessId));
    // Deterministic, before anything else: an opt-out in their words wins.
    const optedOut = isOptOutPhrase(body) || isOptOutKeyword(body);

    // Outreach stops the moment they answer; the reply itself is the next task.
    await cancelOpenTasks(context.businessId, contact.id, "They replied.", { keepReplies: true });

    if (!contact.lead_id && contact.prospect_id) {
      // A prospect's reply takes the existing social reply path: recorded on
      // their conversation, classified (phrase check first, binding),
      // suppressed on an opt-out, and promoted to a lead where the workspace
      // allows it -- which hands the thread to the conversation agent.
      const result = await ingestSocialReply({
        businessId: context.businessId,
        prospectId: contact.prospect_id,
        platform: "LINKEDIN",
        body,
        ingestedBy: "ASSISTED",
        ingestedByUserId: userId,
      });
      if (result.suppressed || optedOut) {
        await stopForOptOut(contact, task.id);
        return { data: { optedOut: true, replyTaskId: null }, entityId: task.id };
      }
      if (result.leadId) {
        await setContactState(context.businessId, contact.id, { lead_id: result.leadId });
        contact = { ...contact, lead_id: result.leadId };
        const { data: prospect } = await createAdminClient()
          .from("prospects")
          .select("conversation_id")
          .eq("business_id", context.businessId)
          .eq("id", contact.prospect_id!)
          .maybeSingle();
        if (prospect?.conversation_id) contact = { ...contact, conversation_id: prospect.conversation_id };
        await ensureLinkedInConversation(contact);
      }
      await setContactState(context.businessId, contact.id, { state: "REPLIED", replied_at: now });
      const replyTaskId = await scheduleTask(contact, {
        kind: "REPLY",
        step: 1,
        dueOn: today,
        dedupeKey: `reply:${contact.id}:${hashOf(body)}`,
        inboundBody: body,
        bodySource: result.leadId ? "AGENT" : "PERSON",
        fallbackReason: result.leadId
          ? null
          : "They are still a prospect, so the assistant does not answer them. Write your reply, or promote them to a lead in Find Leads.",
      });
      return {
        data: { optedOut: false, replyTaskId, classification: result.classification },
        entityId: task.id,
      };
    }

    // A lead: the reply goes on their LinkedIn conversation like any inbound message.
    const conversationId = await ensureLinkedInConversation(contact);
    if (!conversationId || !contact.lead_id) {
      throw new ServiceError("UNAVAILABLE", "The conversation could not be opened. Try again.");
    }
    const providerMessageId = `li-assist:${contact.id}:${hashOf(`${today}:${body}`)}`;
    const { data: stored, error: storeError } = await db()
      .from("messages")
      .insert({
        business_id: context.businessId,
        conversation_id: conversationId,
        lead_id: contact.lead_id,
        direction: "inbound",
        channel: "linkedin",
        body,
        status: "RECEIVED",
        origin: "system",
        provider: "linkedin_assist",
        provider_message_id: providerMessageId,
        received_at: now,
      })
      .select("id")
      .maybeSingle();
    if (storeError?.code === "23505") {
      throw new ServiceError("CONFLICT", "That reply has already been logged.");
    }
    if (storeError || !stored) throw storeError ?? new Error("reply not stored");

    await db()
      .from("conversations")
      .update({ last_inbound_at: now, last_message_at: now })
      .eq("business_id", context.businessId)
      .eq("id", conversationId);
    await stopAutomationRuns(context.businessId, contact.lead_id, "replied");

    if (optedOut) {
      await suppressLead(
        context.businessId,
        contact.lead_id,
        socialAddress("linkedin", linkedInThreadKey(contact.profile_url)),
      );
      await stopForOptOut(contact, task.id);
      return { data: { optedOut: true, replyTaskId: null }, entityId: task.id };
    }

    const { data: lead } = await createAdminClient()
      .from("leads")
      .select("status, first_replied_at")
      .eq("business_id", context.businessId)
      .eq("id", contact.lead_id)
      .maybeSingle();
    const terminal = ["QUALIFIED", "BOOKED", "WON", "LOST"];
    await createAdminClient()
      .from("leads")
      .update({
        first_replied_at: lead?.first_replied_at ?? now,
        last_contact_at: now,
        status: lead && terminal.includes(lead.status) ? lead.status : "RESPONDED",
      })
      .eq("business_id", context.businessId)
      .eq("id", contact.lead_id);
    await setContactState(context.businessId, contact.id, { state: "REPLIED", replied_at: now });

    // The existing text agent drafts the answer: the same turn, validator and
    // deterministic qualification as every channel. On LinkedIn its output is
    // always a DRAFT (agent/policy.ts), because a person sends it.
    const business = await loadBusinessContext(context.businessId);
    const agentOn = Boolean(
      business && business.agent.mode !== "OFF" && business.agent.channels.includes("linkedin") && !subject.leadStatus?.match(/^(WON|LOST)$/),
    );
    const replyTaskId = await scheduleTask(contact, {
      kind: "REPLY",
      step: 1,
      dueOn: today,
      dedupeKey: `reply:${stored.id}`,
      inboundBody: body,
      bodySource: agentOn ? "AGENT" : "PERSON",
      fallbackReason: agentOn
        ? null
        : "The assistant is not switched on for LinkedIn (Agents), so write your own reply.",
    });
    if (agentOn) {
      await enqueueAgentTurn(
        inboundMessageEvent({
          businessId: context.businessId,
          leadId: contact.lead_id,
          conversationId,
          channel: "linkedin",
          provider: "linkedin_assist",
          messageId: stored.id as string,
          body,
          receivedAt: now,
        }),
      );
    }
    return { data: { optedOut: false, replyTaskId, agentDrafting: agentOn }, entityId: task.id };
  },
});

function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** "Stop contacting me" on LinkedIn is an opt-out from everything, as on every channel. */
async function suppressLead(businessId: string, leadId: string, socialAddressKey: string | null) {
  const { data: lead, error } = await createAdminClient()
    .from("leads")
    .select("email, phone_normalized, phone")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  const destinations = [
    ...(lead?.email ? [{ email: lead.email }] : []),
    ...(lead?.phone_normalized || lead?.phone ? [{ phone: lead.phone_normalized ?? lead.phone }] : []),
  ];
  for (const destination of destinations) {
    await suppress({ businessId, ...destination, channel: "ALL", reason: "OPT_OUT", source: "linkedin_reply" });
  }
  // The LinkedIn thread address too, so the conversation agent's own
  // suppression check refuses this thread even for a lead with no email or
  // phone (whose `opted_out` flag has nothing on the list to derive from).
  if (socialAddressKey) {
    await suppress({ businessId, social: socialAddressKey, channel: "ALL", reason: "OPT_OUT", source: "linkedin_reply" });
  }
  await createAdminClient()
    .from("leads")
    .update({ automation_active: false })
    .eq("business_id", businessId)
    .eq("id", leadId);
  await stopAutomationRuns(businessId, leadId, "opted_out");
}

async function stopForOptOut(contact: ContactRow, taskId: string) {
  await cancelOpenTasks(contact.business_id, contact.id, STOP_REASON_LABEL.OPTED_OUT);
  await db()
    .from("linkedin_assist_tasks")
    .update({ status: "CANCELLED", cancelled_reason: STOP_REASON_LABEL.OPTED_OUT })
    .eq("business_id", contact.business_id)
    .eq("id", taskId)
    .eq("status", "OPEN");
  await setContactState(contact.business_id, contact.id, {
    state: "STOPPED",
    stopped_reason: "OPTED_OUT",
    stopped_at: new Date().toISOString(),
  });
}

/* ================================================================ move */

defineOperation("linkedin_assist.move_channel", {
  schema: moveChannelSchema,
  async run({ args, context }) {
    const task = await ownTask(context, args.taskId);
    const contact = await contactFor(task);
    const subject = await subjectFor(contact);
    if (!subject) throw new ServiceError("NOT_FOUND", "That lead or prospect no longer exists.");

    const move = channelMoves(subject.moveLead).find((m) => m.channel === args.channel)!;
    if (!move.allowed || !contact.lead_id) throw new ServiceError("POLICY_BLOCKED", move.reason);

    // The list is re-checked at the moment of the move, per channel: an SMS
    // STOP leaves email open and the other way round.
    const lead = subject.moveLead!;
    const destination = args.channel === "email" ? lead.email! : lead.phone!;
    const channel = args.channel === "email" ? "email" : "sms";
    if (await isSuppressed(context.businessId, destination, channel)) {
      throw new ServiceError("POLICY_BLOCKED", "That address or number is on your do-not-contact list.");
    }

    const reason: LinkedInStopReason = MOVE_STOP_REASON[args.channel];
    await cancelOpenTasks(context.businessId, contact.id, STOP_REASON_LABEL[reason]);
    await setContactState(context.businessId, contact.id, {
      state: "STOPPED",
      stopped_reason: reason,
      stopped_at: new Date().toISOString(),
    });
    return {
      data: { href: `/app/leads/${contact.lead_id}`, channel: args.channel },
      entityId: contact.id,
      before: { state: contact.state },
      after: { state: "STOPPED", stoppedReason: reason },
    };
  },
});

/* ================================================================ settings */

defineOperation("linkedin_assist.update_settings", {
  schema: linkedInAssistSettingsSchema as unknown as z.ZodType<z.infer<typeof linkedInAssistSettingsSchema>>,
  async run({ args, context }) {
    const userId = requireUser(context);
    const { settings: before } = await loadSettings(context.businessId, userId);
    const { error } = await db()
      .from("linkedin_assist_settings")
      .upsert(
        {
          business_id: context.businessId,
          user_id: userId,
          account_tier: args.accountTier,
          daily_connection_notes: args.dailyConnectionNotes,
          weekly_connection_requests: args.weeklyConnectionRequests,
          daily_messages: args.dailyMessages,
          monthly_inmail_credits: args.monthlyInMailCredits,
          follow_up_after_days: args.followUpAfterDays,
          max_follow_ups: args.maxFollowUps,
          paused: args.paused,
        },
        { onConflict: "business_id,user_id" },
      );
    if (error) throw error;
    return { data: { ok: true }, entityId: null, before, after: args };
  },
});
