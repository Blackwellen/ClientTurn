"use client";

import * as React from "react";
import {
  BarChart3,
  CalendarDays,
  Clock,
  Eye,
  MessageSquare,
  Moon,
  Send,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Input, Select, Switch } from "@/components/ui/form";
import { htmlToPlainText, sanitizeEmailHtml } from "@/lib/email/rich-text";
import { RichTextEditor } from "./rich-text-editor";
import { Skeleton } from "@/components/ui/feedback";
import {
  MAX_SUBJECT_LENGTH,
  MERGE_FIELDS,
  previewTemplate,
  segmentInfo,
  type AudiencePreview,
  type SegmentInfo,
} from "@/lib/campaigns/types";
import {
  bodyLimitFor,
  changeChannel,
  FOLLOW_UP_DELAY_OPTIONS,
  scheduledInstant,
  type WizardChannel,
  type WizardState,
} from "./state";
import {
  BigFigure,
  IconTile,
  RailCard,
  StepSection,
  SummaryRow,
  SummaryTable,
  formatCount,
} from "./pieces";

export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
};

export type ChannelOption = {
  value: WizardChannel | "email";
  label: string;
  available: boolean;
  reason?: string;
};

function formatQuietHours(quiet: QuietHours) {
  const to12 = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    const suffix = hours >= 12 ? "PM" : "AM";
    const display = hours % 12 === 0 ? 12 : hours % 12;
    return `${display}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };
  // Quiet hours are stored as the *closed* window, so the sending window is
  // its inverse: sends run from the end of quiet hours to their start.
  return { from: to12(quiet.end), to: to12(quiet.start) };
}

function shortTimezone(timezone: string) {
  return timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
}

/* ------------------------------------------------------------ editors --- */

/**
 * The subject is the only part of an email most leads ever read, so it gets a
 * field of its own with the same merge-field support as the body rather than
 * being buried in the composer toolbar.
 */
function SubjectField({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-content mb-1.5 block text-[13px] font-medium"
      >
        {label}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={MAX_SUBJECT_LENGTH}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-count`}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="text-content-muted text-[11px]">
          {hint ?? "Variables work here too, e.g. {{first_name}}."}
        </p>
        <p
          id={`${id}-count`}
          className="lr-tabular text-content-muted shrink-0 text-[11px]"
        >
          {value.length}/{MAX_SUBJECT_LENGTH}
        </p>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger-600 mt-1 text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Drops a merge field at the caret inside whichever rich editor currently has
 * focus. Returns false when the caret is not in one, so the caller can fall
 * back to appending rather than silently doing nothing.
 */
function insertIntoActiveEditor(token: string): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active?.isContentEditable) return false;
  document.execCommand("insertText", false, token);
  return true;
}

/** The chip row and character counter shown under either editor. */
function VariableChips({
  id,
  onInsert,
  length,
  limit,
  info,
}: {
  id: string;
  onInsert: (token: string) => void;
  length: number;
  limit: number;
  info: SegmentInfo | null;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-content-muted text-[11px]">
          Available variables:
        </span>
        {MERGE_FIELDS.map((field) => (
          <button
            key={field.token}
            type="button"
            onClick={() => onInsert(field.token)}
            className="border-line bg-surface-sunken text-content-secondary hover:border-success-500 hover:text-content rounded-full border px-2 py-0.5 text-[11px] transition-colors"
          >
            {field.token}
          </button>
        ))}
      </div>
      <p
        id={`${id}-count`}
        className={cn(
          "lr-tabular text-[11px]",
          length > limit ? "text-danger-600" : "text-content-muted",
        )}
      >
        {length}/{limit}
        {info
          ? ` · ${info.segments} segment${info.segments === 1 ? "" : "s"} · ${info.encoding}`
          : ""}
      </p>
    </div>
  );
}

/** The "Insert variable" control, shared by the plain and rich editors. */
function MergeFieldMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-content-muted text-[11px]">Insert variable</span>
      <select
        aria-label="Insert variable"
        value=""
        onChange={(event) => {
          if (event.target.value) onInsert(event.target.value);
          event.target.value = "";
        }}
        className="border-line bg-surface text-content h-6 rounded-sm border px-1 text-[11px]"
      >
        <option value="">Choose…</option>
        {MERGE_FIELDS.map((field) => (
          <option key={field.token} value={field.token}>
            {field.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MessageEditor({
  id,
  value,
  onChange,
  channel,
  error,
  rows = 5,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  channel: WizardChannel;
  error?: string;
  rows?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const isEmail = channel === "email";
  const limit = bodyLimitFor(channel);
  // Segments are an SMS billing concept; counting them on an email would be
  // meaningless, so email shows a plain character count instead. An email body
  // is markup, so it is measured by the words in it rather than by its tags.
  const info = isEmail ? null : segmentInfo(value);
  const length = isEmail ? htmlToPlainText(value).length : value.length;

  function insert(token: string) {
    if (isEmail) {
      // The rich editor owns its own caret; appending is the honest fallback
      // when the selection is not inside it.
      if (!insertIntoActiveEditor(token)) onChange(`${value}${token}`);
      return;
    }
    const field = ref.current;
    if (!field) {
      onChange(`${value}${token}`.slice(0, limit));
      return;
    }
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next.slice(0, limit));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  if (isEmail) {
    return (
      <div>
        <RichTextEditor
          id={id}
          value={value}
          onChange={onChange}
          error={error}
          minHeight={rows * 22}
          toolbarExtra={<MergeFieldMenu onInsert={insert} />}
        />
        <VariableChips
          id={id}
          onInsert={insert}
          length={length}
          limit={limit}
          info={null}
        />
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "border-line-strong overflow-hidden rounded-md border shadow-xs",
          error && "border-danger-500",
        )}
      >
        <div className="border-line-subtle bg-surface-sunken/60 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
          <span className="text-content-muted text-[11px] font-medium">
            {channel === "whatsapp" ? "WhatsApp message" : "SMS message"}
          </span>
          <MergeFieldMenu onInsert={insert} />
        </div>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          value={value}
          maxLength={limit}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : `${id}-count`}
          onChange={(event) => onChange(event.target.value)}
          className="text-content placeholder:text-content-subtle w-full resize-y bg-transparent px-3 py-2.5 text-[13px] leading-relaxed focus:outline-none"
          placeholder={
            isEmail
              ? "Hi {{first_name}},\n\nWe quoted you for {{service_name}} a while back and I wanted to check whether it is still something you are considering…"
              : "Hi {{first_name}}, just checking in about your {{service_name}} enquiry…"
          }
        />
      </div>

      <VariableChips
        id={id}
        onInsert={insert}
        length={length}
        limit={limit}
        info={info}
      />

      {error && (
        <p id={`${id}-error`} role="alert" className="text-danger-600 mt-1 text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}

function SendModeCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors",
        selected
          ? "border-success-500 bg-success-50/60"
          : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <input
        type="radio"
        name="send-mode"
        id={id}
        checked={selected}
        onChange={onSelect}
        className="accent-[var(--lr-success-500)] size-4 shrink-0 cursor-pointer"
      />
      <IconTile icon={Icon} tone={selected ? "success" : "info"} className="size-8 rounded-md" />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="text-content block text-[13px] font-semibold">{title}</span>
        <span className="text-content-muted block text-[11px]">{description}</span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------- step 2 --- */

export function MessageTimingStep({
  state,
  patch,
  preview,
  loading,
  businessName,
  quietHours,
  channels,
  fieldErrors,
}: {
  state: WizardState;
  patch: (patch: Partial<WizardState>) => void;
  preview: AudiencePreview | null;
  loading: boolean;
  businessName: string;
  quietHours: QuietHours;
  channels: ChannelOption[];
  fieldErrors: Record<string, string>;
}) {
  const window = formatQuietHours(quietHours);
  const zone = shortTimezone(quietHours.timezone);
  const scheduled = scheduledInstant(state);
  const today = new Date().toISOString().slice(0, 10);

  const renderedPreview = previewTemplate(
    state.initialMessage || "Your message will appear here.",
    businessName,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_392px]">
      {/* ------------------------------------------------------- main --- */}
      <div className="bg-surface border-line divide-line-subtle divide-y rounded-xl border shadow-xs">
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            <IconTile icon={MessageSquare} tone="success" />
            <div>
              <h2 className="text-content text-[17px] font-semibold">
                Step 2 — Message &amp; Timing
              </h2>
              <p className="text-content-muted mt-0.5 text-[13px]">
                Create your outreach and choose when it should send.
              </p>
            </div>
          </div>
        </div>

        {/* initial message */}
        <div className="px-5 py-4">
          <StepSection
            icon={MessageSquare}
            tone="success"
            title="Initial message"
            description="Compose your message and choose the channel."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="initial-channel"
                  className="text-content block text-[13px] font-medium"
                >
                  Channel
                </label>
                <Select
                  id="initial-channel"
                  className="mt-1.5"
                  value={state.channel}
                  aria-invalid={Boolean(fieldErrors.channel)}
                  onChange={(event) =>
                    patch(
                      changeChannel(state, event.target.value as WizardChannel),
                    )
                  }
                >
                  {channels.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={!option.available}
                    >
                      {option.label}
                      {option.available ? "" : " — not available"}
                    </option>
                  ))}
                </Select>
                {channels
                  .filter((option) => !option.available && option.reason)
                  .map((option) => (
                    <p
                      key={option.value}
                      className="text-content-muted mt-1 text-[11px]"
                    >
                      {option.label}: {option.reason}
                    </p>
                  ))}
              </div>

              {/* Email pairs the channel with its subject, as the design
                  does. The texting channels have no subject, so the space is
                  used to say where the message will actually come from. */}
              {state.channel === "email" ? (
                <SubjectField
                  id="initial-subject"
                  label="Subject"
                  value={state.subject}
                  onChange={(value) => patch({ subject: value })}
                  error={fieldErrors.subject}
                  placeholder="Checking in about your {{service_name}} enquiry"
                />
              ) : (
                <div>
                  <span className="text-content block text-[13px] font-medium">
                    Delivery
                  </span>
                  <div className="border-line bg-surface-sunken/50 mt-1.5 flex h-9 items-center rounded-md border px-3">
                    <p className="text-content-muted text-[12px]">
                      Sent from your connected{" "}
                      {state.channel === "whatsapp" ? "WhatsApp" : "SMS"} number.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {state.channel === "email" && (
              <p className="text-content-muted -mt-1 text-[12px]">
                Sent from your own mailbox, so replies arrive in your inbox.
              </p>
            )}

            {fieldErrors.channel && (
              <p role="alert" className="text-danger-600 text-[12px]">
                {fieldErrors.channel}
              </p>
            )}

            <div>
              <label
                htmlFor="initial-message"
                className="text-content mb-1.5 block text-[13px] font-medium"
              >
                {state.channel === "email" ? "Body" : "Message"}
              </label>
              <MessageEditor
                id="initial-message"
                value={state.initialMessage}
                onChange={(value) => patch({ initialMessage: value })}
                channel={state.channel}
                error={fieldErrors.initialMessage}
                rows={state.channel === "email" ? 9 : 5}
              />
            </div>
          </StepSection>
        </div>

        {/* follow-up */}
        <div className="px-5 py-4">
          <StepSection
            icon={MessageSquare}
            tone="info"
            title="Optional one follow-up"
            description="Send one follow-up message to increase your response rate. Only one follow-up is allowed."
            action={
              <div className="flex items-center gap-2">
                <Switch
                  checked={state.followUpEnabled}
                  onCheckedChange={(value) => patch({ followUpEnabled: value })}
                  label="Enable one follow-up message"
                  className={state.followUpEnabled ? "bg-success-500" : undefined}
                />
                <span className="text-content-secondary text-[12px] font-medium">
                  {state.followUpEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            }
          >
            {state.followUpEnabled && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="followup-delay"
                      className="text-content block text-[13px] font-medium"
                    >
                      Send follow-up
                    </label>
                    <Select
                      id="followup-delay"
                      className="mt-1.5"
                      value={String(state.followUpDelayDays)}
                      onChange={(event) =>
                        patch({ followUpDelayDays: Number(event.target.value) })
                      }
                    >
                      {FOLLOW_UP_DELAY_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          + {days} day{days === 1 ? "" : "s"} after initial message
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label
                      htmlFor="followup-channel"
                      className="text-content block text-[13px] font-medium"
                    >
                      Channel
                    </label>
                    <Select
                      id="followup-channel"
                      className="mt-1.5"
                      value={state.followUpChannel}
                      onChange={(event) =>
                        patch({
                          followUpChannel: event.target.value as WizardChannel,
                        })
                      }
                    >
                      {channels.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          disabled={!option.available}
                        >
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <p className="text-content-muted mt-1 text-[11px]">
                      The follow-up uses the campaign channel at send time.
                    </p>
                  </div>
                </div>

                {state.channel === "email" && (
                  <SubjectField
                    id="followup-subject"
                    label="Follow-up subject line"
                    value={state.followUpSubject}
                    onChange={(value) => patch({ followUpSubject: value })}
                    error={fieldErrors.followUpSubject}
                    placeholder="One last check on your {{service_name}}"
                    hint="Leave blank to reuse the subject above."
                  />
                )}

                <div>
                  <label
                    htmlFor="followup-message"
                    className="text-content mb-1.5 block text-[13px] font-medium"
                  >
                    {state.channel === "email" ? "Body" : "Message"}
                  </label>
                  <MessageEditor
                    id="followup-message"
                    value={state.followUpMessage}
                    onChange={(value) => patch({ followUpMessage: value })}
                    channel={state.followUpChannel}
                    error={fieldErrors.followUpMessage}
                    rows={state.channel === "email" ? 7 : 3}
                  />
                </div>

                <p className="text-content-muted text-[12px]">
                  The follow-up is skipped automatically for anyone who has
                  replied, booked, opted out or become suppressed in the
                  meantime.
                </p>
              </>
            )}
          </StepSection>
        </div>

        {/* send mode */}
        <div className="px-5 py-4">
          <StepSection
            icon={CalendarDays}
            tone="success"
            title="Send mode"
            description="Choose when to send your campaign."
          >
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Send mode</legend>
              <SendModeCard
                selected={state.sendMode === "now"}
                onSelect={() => patch({ sendMode: "now" })}
                icon={Send}
                title="Send now"
                description="Send immediately"
              />
              <SendModeCard
                selected={state.sendMode === "schedule"}
                onSelect={() => patch({ sendMode: "schedule" })}
                icon={CalendarDays}
                title="Schedule"
                description="Choose a date and time"
              />
            </fieldset>

            {state.sendMode === "schedule" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="schedule-date"
                    className="text-content block text-[13px] font-medium"
                  >
                    Date
                  </label>
                  <Input
                    id="schedule-date"
                    type="date"
                    className="mt-1.5"
                    min={today}
                    value={state.scheduledDate}
                    aria-invalid={Boolean(fieldErrors.schedule)}
                    onChange={(event) =>
                      patch({ scheduledDate: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor="schedule-time"
                    className="text-content block text-[13px] font-medium"
                  >
                    Time
                  </label>
                  <Input
                    id="schedule-time"
                    type="time"
                    className="mt-1.5"
                    value={state.scheduledTime}
                    aria-invalid={Boolean(fieldErrors.schedule)}
                    onChange={(event) =>
                      patch({ scheduledTime: event.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {fieldErrors.schedule && (
              <p role="alert" className="text-danger-600 text-[12px]">
                {fieldErrors.schedule}
              </p>
            )}

            <div className="border-info-100 bg-info-50 flex items-start gap-3 rounded-lg px-3.5 py-3">
              <IconTile icon={Moon} tone="info" className="size-8 rounded-md" />
              <div className="min-w-0">
                <p className="text-content text-[13px] font-medium">Quiet hours</p>
                <p className="text-content-muted mt-0.5 text-[12px]">
                  {quietHours.enabled ? (
                    <>
                      Messages only send between {window.from} and {window.to} (
                      {zone}). This helps avoid sending messages at night. A send
                      that falls outside the window waits for the next opening.
                    </>
                  ) : (
                    <>
                      Quiet hours are switched off for this workspace, so sends
                      can go out at any time. Turn them on in Settings →
                      Follow-up.
                    </>
                  )}
                </p>
              </div>
            </div>
          </StepSection>
        </div>
      </div>

      {/* ------------------------------------------------------- rail --- */}
      <div className="space-y-4">
        <RailCard
          icon={BarChart3}
          title="Audience summary"
          description="Carried over from step 1."
        >
          {loading || !preview ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <>
              <BigFigure
                value={formatCount(preview.eligible)}
                caption="eligible leads"
                tone={preview.eligible > 0 ? "success" : "danger"}
              />
              <div className="mt-3">
                <SummaryTable>
                  <SummaryRow
                    label="Total ClientTurn leads"
                    value={formatCount(preview.totalLeads)}
                  />
                  <SummaryRow
                    label="After filters"
                    value={formatCount(preview.matched)}
                  />
                  <SummaryRow
                    label="Automatically suppressed"
                    value={formatCount(preview.suppressedTotal)}
                  />
                  <SummaryRow
                    label="Estimated eligible"
                    value={formatCount(preview.eligible)}
                    emphasis
                  />
                </SummaryTable>
              </div>
            </>
          )}
        </RailCard>

        <RailCard
          icon={Eye}
          title="Message preview"
          description="Here's how your initial message will look."
        >
          <div className="border-line bg-surface-sunken/40 rounded-lg border px-3 py-2.5">
            {/* An email is recognised by its subject line, so the preview shows
                the header a lead actually sees rather than a phone number. */}
            <p className="text-content-muted text-[12px]">
              To:{" "}
              <span className="text-content">
                {state.channel === "email"
                  ? "jamie.bell@example.co.uk"
                  : "+44 7700 900000"}
              </span>
            </p>
            {state.channel === "email" && (
              <p className="text-content-muted mt-1 border-b border-line-subtle pb-2 text-[12px]">
                Subject:{" "}
                <span className="text-content font-medium">
                  {state.subject.trim()
                    ? previewTemplate(state.subject, businessName)
                    : "No subject yet"}
                </span>
              </p>
            )}
            {state.channel === "email" ? (
              // Already reduced to the allowlist by `sanitizeEmailHtml` — see
              // `@/lib/email/rich-text`, which drops every tag and attribute
              // outside it, so the only markup that can reach here is the
              // handful of formatting tags an email body may contain.
              <div
                className="lr-rich-text text-content mt-2 text-[13px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(renderedPreview) }}
              />
            ) : (
              <p className="text-content mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">
                {renderedPreview}
              </p>
            )}
          </div>
          <p className="text-content-muted mt-2 text-[11px]">
            This preview shows sample data. Actual messages will use each
            lead&rsquo;s information.
          </p>
        </RailCard>

        <RailCard
          icon={Clock}
          title="Timing summary"
          description="Review your campaign timing and settings."
        >
          <SummaryTable>
            <SummaryRow
              label="Send mode"
              value={state.sendMode === "now" ? "Send now" : "Scheduled"}
            />
            <SummaryRow
              label="Launch time"
              value={
                state.sendMode === "now"
                  ? "Send immediately"
                  : scheduled
                    ? scheduled.toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Not set"
              }
            />
            <SummaryRow
              label="Quiet hours"
              value={
                quietHours.enabled
                  ? `${window.from} – ${window.to} (${zone})`
                  : "Off"
              }
            />
            <SummaryRow
              label="Follow-up"
              value={
                state.followUpEnabled
                  ? `1 follow-up, +${state.followUpDelayDays}d`
                  : "None"
              }
            />
          </SummaryTable>
        </RailCard>
      </div>
    </div>
  );
}
