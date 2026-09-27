"use client";

import * as React from "react";
import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveFollowUpChannelBudget } from "@/lib/follow-up/actions";
import {
  FOLLOW_UP_CHANNEL_STRATEGIES,
  FOLLOW_UP_CHANNEL_STRATEGY_HELP,
  FOLLOW_UP_CHANNEL_STRATEGY_LABEL,
  SMS_CAP_BOUNDS,
  type FollowUpChannelStrategy,
} from "@/lib/follow-up/channel-strategy";

/**
 * Channel & SMS budget: which channel automated steps use, and how many SMS
 * segments one lead may cost. The choice is recorded here; the worker applies
 * it when it queues a step, and the send gate enforces the caps immediately
 * before every SMS goes out.
 */
export function ChannelBudgetCard({
  strategy,
  followUpSmsCap,
  conversationSmsDailyCeiling,
  canEdit,
}: {
  strategy: FollowUpChannelStrategy;
  followUpSmsCap: number;
  conversationSmsDailyCeiling: number;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [choice, setChoice] = React.useState<FollowUpChannelStrategy>(strategy);
  const [followUp, setFollowUp] = React.useState(String(followUpSmsCap));
  const [conversation, setConversation] = React.useState(String(conversationSmsDailyCeiling));
  const [pending, startTransition] = React.useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveFollowUpChannelBudget({
        strategy: choice,
        followUpSmsCap: Number(followUp),
        conversationSmsDailyCeiling: Number(conversation),
      });
      toast(
        result.ok
          ? { variant: "success", title: "Follow-up budget saved." }
          : { variant: "error", title: result.error },
      );
    });
  }

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-info-100 bg-info-50 text-info-600"
        >
          <Wallet className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-content">Channel &amp; SMS budget</h3>
          <p className="text-[12.5px] text-content-muted">Email from your mailbox is free; SMS uses your allowance.</p>
        </div>
      </div>

      <CardContent className="space-y-3 pt-0">
        <fieldset className="space-y-2" disabled={!canEdit || pending}>
          <legend className="sr-only">Channel for automated steps</legend>
          {FOLLOW_UP_CHANNEL_STRATEGIES.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-line p-2.5 has-[:checked]:border-content-accent"
            >
              <input
                type="radio"
                name="follow-up-channel-strategy"
                value={option}
                checked={choice === option}
                onChange={() => setChoice(option)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-content">
                  {FOLLOW_UP_CHANNEL_STRATEGY_LABEL[option]}
                </span>
                <span className="block text-[12px] leading-[1.45] text-content-muted">
                  {FOLLOW_UP_CHANNEL_STRATEGY_HELP[option]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid grid-cols-2 gap-2.5">
          <FormField
            label="Follow-up SMS per lead"
            hint="Segments per sequence, leads who have not replied"
            htmlFor="follow-up-sms-cap"
          >
            <Input
              id="follow-up-sms-cap"
              type="number"
              inputMode="numeric"
              min={SMS_CAP_BOUNDS.followUp.min}
              max={SMS_CAP_BOUNDS.followUp.max}
              value={followUp}
              disabled={!canEdit || pending}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </FormField>
          <FormField
            label="AI reply ceiling"
            hint="SMS segments per lead per 24h (abuse guard)"
            htmlFor="conversation-sms-cap"
          >
            <Input
              id="conversation-sms-cap"
              type="number"
              inputMode="numeric"
              min={SMS_CAP_BOUNDS.conversation.min}
              max={SMS_CAP_BOUNDS.conversation.max}
              value={conversation}
              disabled={!canEdit || pending}
              onChange={(event) => setConversation(event.target.value)}
            />
          </FormField>
        </div>

        <p className="text-[11.5px] leading-[1.45] text-content-subtle">
          Only leads who have not replied are budgeted. Once a lead replies or shows real interest, follow-up stays on their channel and the AI keeps answering them; the ceiling only stops a runaway loop, and then passes the lead to a person.
          Booking reminders are never capped.
        </p>

        {canEdit && (
          <Button size="sm" onClick={save} loading={pending}>
            Save budget
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
