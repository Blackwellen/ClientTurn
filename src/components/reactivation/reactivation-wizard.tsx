"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Rocket, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  Checkbox,
  FormField,
  Input,
  Select,
  Textarea,
} from "@/components/ui/form";
import { formatRelative } from "@/lib/dates";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import { createCampaign, previewAudience } from "@/lib/campaigns/actions";
import {
  MAX_MESSAGE_LENGTH,
  MERGE_FIELDS,
  previewTemplate,
  segmentInfo,
  type AudienceFilter,
  type AudiencePreview,
  type CampaignDraft,
} from "@/lib/campaigns/types";
import {
  AudienceSourceSelector,
  type AudienceSource,
} from "./audience-source-selector";

/**
 * `ReactivationWizard` (spec §17): exactly three steps — Audience,
 * Message & Timing, Review & Launch — replacing the old four-step
 * `CampaignWizard` (Audience, Message, Timing, Review). Step 2 here is the
 * old steps 1+2 merged; step 3 is unchanged. All validation, preview and
 * launch logic is the same `lib/campaigns` actions the old wizard used.
 */

const STEPS = [
  { label: "Audience", description: "Who gets contacted" },
  { label: "Message & timing", description: "What they receive, and when" },
  { label: "Review & launch", description: "Confirm and go" },
];

type Options = {
  services: { id: string; name: string }[];
  sources: { id: string; label: string }[];
};

export function ReactivationWizard({
  businessName,
  options,
  defaultChannel,
  whatsappEnabled,
  aiAssistAllowed,
  quietHours,
}: {
  businessName: string;
  options: Options;
  defaultChannel: "sms" | "whatsapp";
  whatsappEnabled: boolean;
  aiAssistAllowed: boolean;
  quietHours: { enabled: boolean; start: string; end: string; timezone: string };
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [audienceLabel, setAudienceLabel] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [channel, setChannel] = React.useState<"sms" | "whatsapp">(defaultChannel);
  const [audience, setAudience] = React.useState<AudienceFilter>({
    statuses: [],
    lastContactedBeforeDays: 30,
  });
  const [audienceSource, setAudienceSource] = React.useState<AudienceSource>("existing");
  const [extraSources, setExtraSources] = React.useState<{ id: string; label: string }[]>([]);
  const [importedNotice, setImportedNotice] = React.useState<string | null>(null);

  const [message, setMessage] = React.useState("");
  const [followupEnabled, setFollowupEnabled] = React.useState(false);
  const [followup, setFollowup] = React.useState("");
  const [followupDelayHours, setFollowupDelayHours] = React.useState(48);
  const [sendMode, setSendMode] = React.useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [sendRatePerMinute, setSendRatePerMinute] = React.useState(20);
  const [aiPersonalize, setAiPersonalize] = React.useState(false);

  const [preview, setPreview] = React.useState<AudiencePreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewing, startPreview] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const messageRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      startPreview(async () => {
        const result = await previewAudience(audience);
        if (result.ok) {
          setPreview(result.data);
          setPreviewError(null);
        } else {
          setPreview(null);
          setPreviewError(result.error);
        }
      });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [audience]);

  const segments = segmentInfo(message);
  const followupSegments = segmentInfo(followup);
  const eligible = preview?.eligible ?? 0;
  const estimatedMessages =
    eligible * segments.segments + (followupEnabled ? eligible * followupSegments.segments : 0);

  function patchAudience(patch: Partial<AudienceFilter>) {
    setAudience((current) => ({ ...current, ...patch }));
  }

  function toggleStatus(status: (typeof LEAD_STATUSES)[number]) {
    setAudience((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((entry) => entry !== status)
        : [...current.statuses, status],
    }));
  }

  function onImported(result: { sourceId: string; label: string; imported: number }) {
    setExtraSources((current) => [
      { id: result.sourceId, label: result.label },
      ...current.filter((source) => source.id !== result.sourceId),
    ]);
    patchAudience({ sourceId: result.sourceId });
    setAudienceSource("existing");
    setImportedNotice(
      `Using "${result.label}" (${result.imported.toLocaleString("en-GB")} contacts) as the audience source.`,
    );
  }

  function insertMergeField(token: string) {
    const field = messageRef.current;
    if (!field) {
      setMessage((current) => `${current}${token}`);
      return;
    }
    const start = field.selectionStart ?? message.length;
    const end = field.selectionEnd ?? message.length;
    const next = `${message.slice(0, start)}${token}${message.slice(end)}`;
    setMessage(next.slice(0, MAX_MESSAGE_LENGTH));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const stepValid = [
    name.trim().length >= 2,
    message.trim().length >= 10 && (!followupEnabled || followup.trim().length >= 10) &&
      (sendMode === "now" || scheduledAt.length > 0),
    eligible > 0,
  ];

  function draft(): CampaignDraft {
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      audienceLabel: audienceLabel.trim() || undefined,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8),
      channel,
      audience,
      message: message.trim(),
      followup: followupEnabled ? followup.trim() : undefined,
      followupDelayHours,
      sendMode,
      scheduledAt: sendMode === "schedule" ? scheduledAt : undefined,
      sendRatePerMinute,
      aiPersonalize: aiAssistAllowed && aiPersonalize,
    };
  }

  async function submit(launch: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createCampaign(draft(), launch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        variant: "success",
        title: launch ? "Campaign launched" : "Draft saved",
        description: launch
          ? "Sending starts within the next send window."
          : "You can launch it from the reactivation list.",
      });
      router.push(`/app/reactivation?campaign=${result.data.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }

  const allSources = [...extraSources, ...options.sources];

  return (
    <div className="space-y-4">
      <Stepper steps={STEPS} current={step} />

      {error && (
        <div className="border-danger-100 bg-danger-50 text-danger-700 rounded-lg border px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {step === 0 && (
            <Card>
              <CardHeader>
                <SectionHeader
                  title="Audience"
                  description="Pick the old leads worth another try, from your existing leads or a fresh CSV import. Suppression is applied on top and cannot be turned off."
                />
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField
                  label="Campaign name"
                  htmlFor="campaign-name"
                  required
                  hint="Only you see this."
                >
                  <Input
                    id="campaign-name"
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Spring boiler service recall"
                  />
                </FormField>

                <FormField
                  label="Description"
                  htmlFor="campaign-description"
                  hint="One line on what this campaign is for. Shown on the campaign card."
                >
                  <Textarea
                    id="campaign-description"
                    rows={2}
                    value={description}
                    maxLength={280}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Re-engage past quote requests with a seasonal check offer."
                  />
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Audience name"
                    htmlFor="campaign-audience-label"
                    hint="The label only — who is contacted comes from the rules below."
                  >
                    <Input
                      id="campaign-audience-label"
                      value={audienceLabel}
                      maxLength={160}
                      onChange={(event) => setAudienceLabel(event.target.value)}
                      placeholder="Past quote requests"
                    />
                  </FormField>

                  <FormField
                    label="Tags"
                    htmlFor="campaign-tags"
                    hint="Comma separated, up to eight."
                  >
                    <Input
                      id="campaign-tags"
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      placeholder="Seasonal, Roofing"
                    />
                  </FormField>
                </div>

                <AudienceSourceSelector
                  source={audienceSource}
                  onSourceChange={setAudienceSource}
                  onImported={onImported}
                />

                {importedNotice && (
                  <p className="text-success-700 text-[12px]">{importedNotice}</p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Service" htmlFor="campaign-service">
                    <Select
                      id="campaign-service"
                      value={audience.serviceId ?? ""}
                      onChange={(event) =>
                        patchAudience({ serviceId: event.target.value || undefined })
                      }
                    >
                      <option value="">Any service</option>
                      {options.services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Source" htmlFor="campaign-source">
                    <Select
                      id="campaign-source"
                      value={audience.sourceId ?? ""}
                      onChange={(event) =>
                        patchAudience({ sourceId: event.target.value || undefined })
                      }
                    >
                      <option value="">Any source</option>
                      {allSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Received after" htmlFor="campaign-after">
                    <Input
                      id="campaign-after"
                      type="date"
                      value={audience.createdAfter ?? ""}
                      max={audience.createdBefore}
                      onChange={(event) =>
                        patchAudience({ createdAfter: event.target.value || undefined })
                      }
                    />
                  </FormField>

                  <FormField label="Received before" htmlFor="campaign-before">
                    <Input
                      id="campaign-before"
                      type="date"
                      value={audience.createdBefore ?? ""}
                      min={audience.createdAfter}
                      onChange={(event) =>
                        patchAudience({ createdBefore: event.target.value || undefined })
                      }
                    />
                  </FormField>
                </div>

                <FormField
                  label="Not contacted in the last"
                  htmlFor="campaign-cooldown"
                  hint="Anyone messaged more recently than this is excluded."
                >
                  <Select
                    id="campaign-cooldown"
                    value={String(audience.lastContactedBeforeDays)}
                    onChange={(event) =>
                      patchAudience({ lastContactedBeforeDays: Number(event.target.value) })
                    }
                  >
                    {[7, 14, 30, 60, 90, 180, 365].map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </Select>
                </FormField>

                <fieldset>
                  <legend className="text-content text-[13px] font-medium">Lead status</legend>
                  <p className="text-content-muted mt-0.5 text-[12px]">
                    Leave all unticked to include every status.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {LEAD_STATUSES.map((status) => (
                      <label
                        key={status}
                        className="text-content-secondary flex items-center gap-2 text-[13px]"
                      >
                        <Checkbox
                          checked={audience.statuses.includes(status)}
                          onChange={() => toggleStatus(status)}
                        />
                        {status.charAt(0) + status.slice(1).toLowerCase()}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* EligibilitySummary + SuppressionSummary */}
                <div className="border-line bg-surface-sunken rounded-lg border px-3 py-2.5">
                  <p className="text-content-secondary text-[13px]">
                    <strong className="text-content lr-tabular">
                      {eligible.toLocaleString("en-GB")}
                    </strong>{" "}
                    eligible of{" "}
                    <strong className="text-content lr-tabular">
                      {(preview?.matched ?? 0).toLocaleString("en-GB")}
                    </strong>{" "}
                    matching leads.
                  </p>
                  {preview && preview.suppressed.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {preview.suppressed.map((group) => (
                        <li key={group.reason} className="flex items-center justify-between gap-2">
                          <span className="text-content-muted text-[12px]">{group.label}</span>
                          <Badge tone="neutral">{group.count}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <Card>
              <CardHeader>
                <SectionHeader
                  title="Message & timing"
                  description="One opening message, at most one follow-up, and when it sends. Reactivation is not a drip sequence."
                />
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField label="Channel" htmlFor="campaign-channel">
                  <Select
                    id="campaign-channel"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as "sms" | "whatsapp")}
                  >
                    <option value="sms">SMS</option>
                    <option value="whatsapp" disabled={!whatsappEnabled}>
                      WhatsApp{whatsappEnabled ? "" : " (Growth plan and above)"}
                    </option>
                  </Select>
                </FormField>

                <FormField
                  label="Opening message"
                  htmlFor="campaign-message"
                  required
                  hint={`${segments.characters} characters · ${segments.segments} ${segments.segments === 1 ? "segment" : "segments"} · ${segments.encoding}`}
                >
                  <Textarea
                    id="campaign-message"
                    ref={messageRef}
                    rows={4}
                    maxLength={MAX_MESSAGE_LENGTH}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Hi {{first_name}}, it's {{business_name}}. You enquired about {{service_name}} a while ago — would you still like a quote?"
                  />
                </FormField>

                <div className="flex flex-wrap gap-1.5">
                  {MERGE_FIELDS.map((field) => (
                    <button
                      key={field.token}
                      type="button"
                      onClick={() => insertMergeField(field.token)}
                      className="border-line bg-surface-sunken text-content-secondary hover:text-content focus-visible:outline-content-accent rounded-full border px-2.5 py-1 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1"
                    >
                      {field.label}
                    </button>
                  ))}
                </div>

                <div className="border-line space-y-3 rounded-lg border p-3">
                  <label className="text-content flex items-center gap-2 text-[13px] font-medium">
                    <Checkbox
                      checked={followupEnabled}
                      onChange={(event) => setFollowupEnabled(event.target.checked)}
                    />
                    Send one follow-up if there is no reply
                  </label>

                  {followupEnabled && (
                    <>
                      <FormField
                        label="Follow-up message"
                        htmlFor="campaign-followup"
                        hint={`${followupSegments.characters} characters · ${followupSegments.segments} ${followupSegments.segments === 1 ? "segment" : "segments"}`}
                      >
                        <Textarea
                          id="campaign-followup"
                          rows={3}
                          maxLength={MAX_MESSAGE_LENGTH}
                          value={followup}
                          onChange={(event) => setFollowup(event.target.value)}
                          placeholder="Just checking you saw this, {{first_name}} — happy to help whenever suits."
                        />
                      </FormField>

                      <FormField label="Send the follow-up after" htmlFor="campaign-followup-delay">
                        <Select
                          id="campaign-followup-delay"
                          value={String(followupDelayHours)}
                          onChange={(event) => setFollowupDelayHours(Number(event.target.value))}
                        >
                          {[24, 48, 72, 120, 168].map((hours) => (
                            <option key={hours} value={hours}>
                              {hours / 24} days
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </>
                  )}
                </div>

                {aiAssistAllowed && (
                  <label className="text-content-secondary flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="accent-[var(--lr-accent-600)]"
                      checked={aiPersonalize}
                      onChange={(event) => setAiPersonalize(event.target.checked)}
                    />
                    Let AI restyle this message per lead, using only the merge
                    fields above — it never adds new claims
                  </label>
                )}

                <fieldset className="space-y-2">
                  <legend className="text-content text-[13px] font-medium">When to start</legend>
                  <label className="text-content-secondary flex items-center gap-2 text-[13px]">
                    <input
                      type="radio"
                      name="send-mode"
                      className="accent-[var(--lr-accent-600)]"
                      checked={sendMode === "now"}
                      onChange={() => setSendMode("now")}
                    />
                    Send as soon as the next send window opens
                  </label>
                  <label className="text-content-secondary flex items-center gap-2 text-[13px]">
                    <input
                      type="radio"
                      name="send-mode"
                      className="accent-[var(--lr-accent-600)]"
                      checked={sendMode === "schedule"}
                      onChange={() => setSendMode("schedule")}
                    />
                    Schedule a date and time
                  </label>
                </fieldset>

                {sendMode === "schedule" && (
                  <FormField
                    label="Start sending"
                    htmlFor="campaign-scheduled"
                    hint={`Times are in ${quietHours.timezone}.`}
                  >
                    <Input
                      id="campaign-scheduled"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="w-auto"
                    />
                  </FormField>
                )}

                <FormField
                  label="Send rate"
                  htmlFor="campaign-rate"
                  hint="Messages per minute. A slower rate keeps replies manageable and protects your number's reputation."
                >
                  <Select
                    id="campaign-rate"
                    value={String(sendRatePerMinute)}
                    onChange={(event) => setSendRatePerMinute(Number(event.target.value))}
                    className="w-auto"
                  >
                    {[5, 10, 20, 30, 60].map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} per minute
                      </option>
                    ))}
                  </Select>
                </FormField>

                <div className="border-line bg-surface-sunken rounded-lg border px-3 py-2.5">
                  <p className="text-content flex items-center gap-2 text-[13px] font-medium">
                    <ShieldCheck className="text-success-600 size-4" aria-hidden />
                    Quiet hours
                  </p>
                  <p className="text-content-muted mt-1 text-[12px]">
                    {quietHours.enabled
                      ? `No message is sent between ${quietHours.start} and ${quietHours.end} (${quietHours.timezone}).`
                      : "Quiet hours are switched off for this workspace. Turn them on in Settings if you want overnight sends blocked."}
                  </p>
                </div>

                {/* MessagePreviewCard */}
                <div>
                  <p className="text-content text-[13px] font-medium">Message preview</p>
                  <div className="border-line bg-surface-sunken mt-1.5 rounded-lg border px-3 py-2.5">
                    <p className="text-content text-[13px] whitespace-pre-wrap">
                      {previewTemplate(message, businessName) || "—"}
                    </p>
                  </div>
                  {followupEnabled && followup.trim() && (
                    <div className="border-line bg-surface-sunken mt-2 rounded-lg border px-3 py-2.5">
                      <p className="text-content-subtle text-[12px]">
                        Follow-up after {followupDelayHours / 24} days
                      </p>
                      <p className="text-content mt-1 text-[13px] whitespace-pre-wrap">
                        {previewTemplate(followup, businessName)}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <CardHeader>
                <SectionHeader
                  title="Review & launch"
                  description="Exactly who will be contacted, and who will not."
                />
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-content-muted text-[12px]">Will be contacted</dt>
                    <dd className="text-content lr-tabular text-[20px] font-semibold">
                      {eligible.toLocaleString("en-GB")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-content-muted text-[12px]">Excluded</dt>
                    <dd className="text-content lr-tabular text-[20px] font-semibold">
                      {(preview?.suppressed ?? [])
                        .reduce((total, group) => total + group.count, 0)
                        .toLocaleString("en-GB")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-content-muted text-[12px]">Estimated messages</dt>
                    <dd className="text-content lr-tabular text-[20px] font-semibold">
                      {estimatedMessages.toLocaleString("en-GB")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-content-muted text-[12px]">Channel</dt>
                    <dd className="text-content text-[20px] font-semibold uppercase">{channel}</dd>
                  </div>
                </dl>

                <div>
                  <p className="text-content text-[13px] font-medium">Final message preview</p>
                  <div className="border-line bg-surface-sunken mt-1.5 rounded-lg border px-3 py-2.5">
                    <p className="text-content text-[13px] whitespace-pre-wrap">
                      {previewTemplate(message, businessName)}
                    </p>
                  </div>
                  {followupEnabled && followup.trim() && (
                    <div className="border-line bg-surface-sunken mt-2 rounded-lg border px-3 py-2.5">
                      <p className="text-content-subtle text-[12px]">
                        Follow-up after {followupDelayHours / 24} days
                      </p>
                      <p className="text-content mt-1 text-[13px] whitespace-pre-wrap">
                        {previewTemplate(followup, businessName)}
                      </p>
                    </div>
                  )}
                </div>

                {preview && preview.sample.length > 0 && (
                  <div>
                    <p className="text-content text-[13px] font-medium">Who will be contacted</p>
                    <ul className="divide-line mt-1.5 divide-y">
                      {preview.sample.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="text-content min-w-0 truncate text-[13px]">
                            {row.name}
                            {row.service && (
                              <span className="text-content-subtle ml-1.5 text-[12px]">
                                {row.service}
                              </span>
                            )}
                          </span>
                          <span className="text-content-subtle shrink-0 text-[12px]">
                            {row.lastContactAt
                              ? `Last contacted ${formatRelative(row.lastContactAt)}`
                              : "Never contacted"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {eligible > preview.sample.length && (
                      <p className="text-content-subtle mt-1.5 text-[12px]">
                        and {(eligible - preview.sample.length).toLocaleString("en-GB")} more.
                      </p>
                    )}
                  </div>
                )}

                {preview && preview.suppressed.length > 0 && (
                  <div>
                    <p className="text-content text-[13px] font-medium">Who is excluded, and why</p>
                    <ul className="divide-line mt-1.5 divide-y">
                      {preview.suppressed.map((group) => (
                        <li key={group.reason} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="text-content text-[13px]">{group.label}</span>
                          <span className="text-content lr-tabular text-[13px] font-semibold">
                            {group.count.toLocaleString("en-GB")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {eligible === 0 && (
                  <div className="border-warning-100 bg-warning-50 text-warning-700 rounded-lg border px-3 py-2.5 text-[13px]">
                    Nobody is eligible with these filters, so this campaign cannot be
                    launched. Widen the audience in step 1.
                  </div>
                )}

                {preview?.cappedAt && (
                  <p className="text-warning-700 text-[12px]">
                    This audience is larger than the {preview.cappedAt.toLocaleString("en-GB")}{" "}
                    contact cap for a single campaign. Only the most recent{" "}
                    {preview.cappedAt.toLocaleString("en-GB")} will be contacted.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={step === 0 || submitting}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Back
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                loading={submitting}
                disabled={!stepValid[0] || !message.trim()}
                onClick={() => submit(false)}
              >
                Save as draft
              </Button>

              {step < STEPS.length - 1 ? (
                <Button
                  size="sm"
                  disabled={!stepValid[step]}
                  onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
                >
                  Continue
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={eligible === 0 || submitting}
                  onClick={() => setConfirming(true)}
                >
                  <Rocket className="size-3.5" aria-hidden />
                  Launch campaign
                </Button>
              )}
            </div>
          </div>
        </div>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <SectionHeader title="Estimated audience" />
          </CardHeader>
          <CardContent className="pt-0">
            {previewError ? (
              <p className="text-danger-600 text-[13px]">{previewError}</p>
            ) : (
              <>
                <p
                  aria-live="polite"
                  className={`text-content lr-tabular text-[32px] leading-none font-semibold ${previewing ? "opacity-60" : ""}`}
                >
                  {eligible.toLocaleString("en-GB")}
                </p>
                <p className="text-content-muted mt-2 text-[13px]">
                  contactable {eligible === 1 ? "lead" : "leads"} out of{" "}
                  {(preview?.matched ?? 0).toLocaleString("en-GB")} matching your filters.
                </p>

                {preview && preview.suppressed.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {preview.suppressed.map((group) => (
                      <li key={group.reason} className="flex items-center justify-between gap-2">
                        <span className="text-content-muted min-w-0 truncate text-[12px]">
                          {group.label}
                        </span>
                        <Badge tone="neutral">{group.count}</Badge>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-content-subtle border-line mt-3 border-t pt-3 text-[12px]">
                  Recounted immediately before sending, so anyone who opts out or
                  books in the meantime is dropped automatically.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => submit(true)}
        title="Launch this campaign?"
        scope={`${eligible.toLocaleString("en-GB")} ${eligible === 1 ? "lead" : "leads"} will be contacted by ${channel.toUpperCase()}, about ${estimatedMessages.toLocaleString("en-GB")} messages in total.`}
        consequence="Sending starts in the next permitted window and cannot be undone once a message has gone out. You can pause or cancel the rest at any time."
        confirmLabel="Launch campaign"
        loading={submitting}
      />
    </div>
  );
}
