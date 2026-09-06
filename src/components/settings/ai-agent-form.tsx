"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { saveAiBehaviour } from "@/lib/ai-settings/actions";
import {
  AGENT_CHANNEL_OPTIONS,
  AGENT_MODE_OPTIONS,
  AI_TONE_OPTIONS,
  type AgentChannelValue,
  type AiBehaviourSettings,
} from "@/lib/ai-settings/types";

/**
 * The whole customer-facing surface of the conversation agent: whether it
 * runs, how, and on which channels. Four controls, by design — model choice,
 * prompts, step budgets and confidence thresholds are platform concerns and
 * are never exposed here.
 *
 * The form deliberately makes the safe option the obvious one: a workspace
 * that has never touched this sees Off, and "Suggest replies" sits between
 * Off and full automation so trying the agent does not mean trusting it
 * with a customer first.
 */
export function AiAgentForm({
  settings,
  readOnly,
  aiAssistAllowed,
  whatsappEnabled,
  emailConnected,
}: {
  settings: AiBehaviourSettings;
  readOnly: boolean;
  /** Whether the plan includes AI assist at all. */
  aiAssistAllowed: boolean;
  whatsappEnabled: boolean;
  emailConnected: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [mode, setMode] = React.useState(settings.agentMode);
  const [channels, setChannels] = React.useState<AgentChannelValue[]>(settings.agentChannels);
  const [tone, setTone] = React.useState(settings.tone);
  const [handoverOnReview, setHandoverOnReview] = React.useState(
    settings.agentHandoverOnReview,
  );
  const [answerServiceQuestions, setAnswerServiceQuestions] = React.useState(
    settings.agentAnswerServiceQuestions,
  );
  const [handoverInstruction, setHandoverInstruction] = React.useState(
    settings.handoverInstruction,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const locked = readOnly || !aiAssistAllowed;

  function channelAvailable(value: AgentChannelValue) {
    if (value === "whatsapp") return whatsappEnabled;
    if (value === "email") return emailConnected;
    return true;
  }

  function toggleChannel(value: AgentChannelValue) {
    setChannels((current) =>
      current.includes(value)
        ? current.filter((channel) => channel !== value)
        : [...current, value],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Caught here so the message is useful, but the server re-checks it: an
    // agent with no channel would silently never run.
    if (enabled && mode !== "OFF" && channels.length === 0) {
      setError("Choose at least one channel for the assistant to work on.");
      return;
    }

    setSaving(true);
    const result = await saveAiBehaviour({
      ...settings,
      enabled,
      tone,
      agentMode: mode,
      agentChannels: channels,
      agentHandoverOnReview: handoverOnReview,
      agentAnswerServiceQuestions: answerServiceQuestions,
      handoverInstruction,
    });
    setSaving(false);

    if (result.ok) {
      toast({ variant: "success", title: "AI assistant settings saved" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const activeMode = AGENT_MODE_OPTIONS.find((option) => option.value === mode);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <SectionHeader
            icon={Bot}
            title="AI assistant"
            description="Answers new leads, qualifies them against your rules, and passes anything it should not handle to your team."
            action={
              <Badge tone={enabled && mode !== "OFF" ? "accent" : "neutral"}>
                {enabled ? (activeMode?.label ?? "Off") : "Off"}
              </Badge>
            }
          />
        </CardHeader>

        <CardContent className="space-y-5">
          {!aiAssistAllowed ? (
            <p className="text-muted text-sm">
              The AI assistant is not included in your current plan. Upgrade to turn it on.
            </p>
          ) : null}

          <label className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled}
              disabled={locked}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">Use AI in this workspace</span>
              <span className="text-muted block text-sm">
                Turning this off stops the assistant and all AI wording immediately.
              </span>
            </span>
          </label>

          <fieldset className="space-y-2" disabled={locked || !enabled}>
            <legend className="mb-1 text-sm font-medium">What the assistant may do</legend>
            {AGENT_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                <input
                  type="radio"
                  name="agentMode"
                  className="mt-1"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="text-muted block text-sm">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2" disabled={locked || !enabled || mode === "OFF"}>
            <legend className="mb-1 text-sm font-medium">Channels</legend>
            <div className="flex flex-wrap gap-2">
              {AGENT_CHANNEL_OPTIONS.map((option) => {
                const available = channelAvailable(option.value);
                return (
                  <label
                    key={option.value}
                    className="border-line hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  >
                    <input
                      type="checkbox"
                      checked={channels.includes(option.value)}
                      disabled={!available}
                      onChange={() => toggleChannel(option.value)}
                    />
                    <span className="text-sm">{option.label}</span>
                    {!available ? (
                      <span className="text-muted text-xs">(not connected)</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2" disabled={locked || !enabled || mode === "OFF"}>
            <legend className="mb-1 text-sm font-medium">When to involve a person</legend>

            <label className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                type="checkbox"
                className="mt-1"
                checked={handoverOnReview}
                onChange={(event) => setHandoverOnReview(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  Hand over when qualification needs review
                </span>
                <span className="text-muted block text-sm">
                  Recommended. A reply your rules cannot decide goes to your team instead of
                  getting a guess.
                </span>
              </span>
            </label>

            <label className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                type="checkbox"
                className="mt-1"
                checked={answerServiceQuestions}
                onChange={(event) => setAnswerServiceQuestions(event.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  Answer questions about your services
                </span>
                <span className="text-muted block text-sm">
                  Only from what you have configured. It never quotes a price you have not
                  published, and never promises a time or an area.
                </span>
              </span>
            </label>
          </fieldset>

          <FormField
            label="Tone"
            htmlFor="agent-tone"
            hint="How the assistant sounds. It stays concise on SMS and WhatsApp either way."
          >
            <select
              id="agent-tone"
              className="border-line bg-surface w-full rounded-lg border px-3 py-2 text-sm"
              value={tone}
              disabled={locked || !enabled}
              onChange={(event) =>
                setTone(event.target.value as AiBehaviourSettings["tone"])
              }
            >
              {AI_TONE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option[0].toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Extra handover rule"
            htmlFor="agent-handover"
            hint="Optional. Anything else that should always go to a person — for example a specific service or a job over a certain size."
          >
            <textarea
              id="agent-handover"
              rows={2}
              maxLength={300}
              className="border-line bg-surface w-full rounded-lg border px-3 py-2 text-sm"
              value={handoverInstruction}
              disabled={locked || !enabled || mode === "OFF"}
              onChange={(event) => setHandoverInstruction(event.target.value)}
            />
          </FormField>

          {error ? <p className="text-danger text-sm">{error}</p> : null}
        </CardContent>

        <CardFooter>
          <Button type="submit" disabled={locked || saving}>
            {saving ? "Saving…" : "Save assistant settings"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
