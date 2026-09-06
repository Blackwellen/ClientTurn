"use client";

import * as React from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { MergeFieldMenu } from "@/components/follow-up/merge-field-menu";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import { sendFollowUpTest } from "@/lib/follow-up/actions";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@/lib/automations/types";
import { DEFAULT_TEST_MESSAGE, testSendSchema } from "@/lib/follow-up/types";

/**
 * Sends one message to the person configuring the sequence, so they can see
 * what a lead sees.
 *
 * It deliberately does not enter the lead pipeline: no lead row, no
 * conversation, no automation run — a test can never be mistaken for a real
 * enquiry or show up in analytics. Merge fields are resolved on the server
 * from workspace values, and the send is rate-limited per workspace because
 * it reaches a real carrier.
 */
export function TestFollowUpPanel({
  canEdit,
  whatsappEnabled,
  defaultTo,
}: {
  canEdit: boolean;
  whatsappEnabled: boolean;
  defaultTo: string | null;
}) {
  const { toast } = useToast();
  const [to, setTo] = React.useState(defaultTo ?? "");
  const [channel, setChannel] = React.useState<Channel>("sms");
  const [body, setBody] = React.useState(DEFAULT_TEST_MESSAGE);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  const unknown = findUnknownMergeFields(body);
  const parsed = testSendSchema.safeParse({ to, channel, body });
  const ready = parsed.success && unknown.length === 0;

  async function send() {
    if (!ready || sending) return; // also guards a double click
    setSending(true);
    setError(null);
    try {
      const result = await sendFollowUpTest({ to, channel, body });
      if (result.ok) {
        toast({
          variant: "success",
          title: channel === "sms" ? "Test SMS sent" : "Test WhatsApp message sent",
        });
      } else {
        setError(result.error);
        toast({ variant: "error", title: "Unable to send test message" });
      }
    } finally {
      setSending(false);
    }
  }

  if (!canEdit) return null;

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-0 border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          dense
          icon={Send}
          tone="info"
          title="Test your follow-up"
          description="Send a test message to yourself to see how it looks."
        />
      </CardHeader>

      <CardContent className="space-y-3 px-5 pt-4 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="test-to">
              Send test to
            </Label>
            <Input
              id="test-to"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={to}
              maxLength={30}
              placeholder="+44 7700 900000"
              disabled={sending}
              aria-invalid={to !== "" && !parsed.success ? true : undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] font-normal" htmlFor="test-channel">
              Channel
            </Label>
            <Select
              id="test-channel"
              value={channel}
              disabled={sending}
              onChange={(event) => setChannel(event.target.value as Channel)}
            >
              {CHANNELS.map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={option === "whatsapp" && !whatsappEnabled}
                >
                  {CHANNEL_LABEL[option]}
                  {option === "whatsapp" && !whatsappEnabled ? " — Growth plan" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px] font-normal" htmlFor="test-body">
            Test message
          </Label>
          <div className="flex items-start gap-2">
            <Textarea
              id="test-body"
              ref={bodyRef}
              rows={3}
              maxLength={1200}
              value={body}
              disabled={sending}
              aria-invalid={unknown.length > 0 || undefined}
              className="min-h-[4rem] flex-1 px-2.5 py-1.5 text-[12px] leading-[1.4]"
              onChange={(event) => setBody(event.target.value)}
            />
            <MergeFieldMenu
              targetRef={bodyRef}
              value={body}
              disabled={sending}
              label="Insert a merge field into the test message"
              onInsert={setBody}
            />
          </div>
          {unknown.length > 0 && (
            <p className="text-danger-600 text-[12px]">
              Unknown merge {unknown.length === 1 ? "field" : "fields"}:{" "}
              {unknown.map((token) => `{{${token}}}`).join(", ")}
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="border-danger-100 bg-danger-50 rounded-lg border px-3 py-2.5"
          >
            <p className="text-danger-700 text-[13px] font-medium">
              The test message did not send
            </p>
            <p className="text-content-secondary mt-0.5 text-[13px]">{error}</p>
            <Link
              href="/app/settings?section=connections"
              className="text-content-accent mt-1.5 inline-block text-[12px] font-medium"
            >
              Check your messaging connection
            </Link>
          </div>
        )}

        <Button
          fullWidth
          variant="secondary"
          onClick={send}
          loading={sending}
          disabled={!ready}
        >
          Send test message
        </Button>
      </CardContent>
    </Card>
  );
}
