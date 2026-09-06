"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { SenderIdentityRow } from "@/lib/outreach/types";
import {
  createCampaignAction,
  createSenderIdentityAction,
} from "@/lib/outreach/actions";

/**
 * Creating an acquisition campaign, and the sending identity it needs.
 *
 * Two dialogs rather than one wizard, because they are owned by different
 * decisions: the identity is "who this business is when it writes to a
 * stranger" and is set up once, while a campaign is "what we are saying to
 * whom" and there are many.
 *
 * Neither dialog can launch anything. A campaign is created as a draft and
 * launched separately, so the moment a workspace starts emailing strangers is
 * always a distinct, deliberate click.
 */

const GRADES = ["A+", "A", "B", "C", "D"] as const;

export function CampaignBuilder({
  senders,
  mailboxConnected,
  canManage,
}: {
  senders: SenderIdentityRow[];
  mailboxConnected: boolean;
  canManage: boolean;
}) {
  const [creatingCampaign, setCreatingCampaign] = React.useState(false);
  const [creatingSender, setCreatingSender] = React.useState(false);

  const usable = senders.filter(
    (sender) => sender.status === "VERIFIED" && sender.coldEnabled,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="md"
        disabled={!canManage || usable.length === 0}
        onClick={() => setCreatingCampaign(true)}
        title={
          usable.length === 0
            ? "Create a verified sending identity first — a campaign cannot send without one."
            : undefined
        }
      >
        <Plus className="size-4" aria-hidden />
        New campaign
      </Button>

      <Button
        variant="secondary"
        size="md"
        disabled={!canManage || !mailboxConnected}
        onClick={() => setCreatingSender(true)}
        title={
          mailboxConnected
            ? undefined
            : "Connect a mailbox in Settings → Connections first."
        }
      >
        <Mail className="size-4" aria-hidden />
        {senders.length > 0 ? "Sending identity" : "Set up sending identity"}
      </Button>

      {creatingCampaign && (
        <CampaignDialog
          senders={usable}
          onClose={() => setCreatingCampaign(false)}
        />
      )}
      {creatingSender && <SenderDialog onClose={() => setCreatingSender(false)} />}
    </div>
  );
}

/* --------------------------------------------------------------- sender */

function SenderDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [displayName, setDisplayName] = React.useState("");
  const [postalFooter, setPostalFooter] = React.useState("");
  const [signature, setSignature] = React.useState("");
  const [dailyCap, setDailyCap] = React.useState(50);

  const submit = () => {
    startTransition(async () => {
      const result = await createSenderIdentityAction({
        displayName,
        postalFooter,
        signatureText: signature || null,
        dailySendCap: dailyCap,
      });

      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }

      toast({
        variant:
          result.data.status === "VERIFIED" ? "success" : "warning",
        title:
          result.data.status === "VERIFIED"
            ? "Sending identity ready."
            : "Sending identity saved, but not verified.",
        description:
          result.data.status === "VERIFIED"
            ? "Campaigns can now send from your connected mailbox."
            : "Test your mailbox connection — cold campaigns will not run until it passes.",
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal open onClose={onClose} title="Sending identity">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-content-muted">
          Cold email is sent from your own connected mailbox, so the address is
          taken from that connection rather than typed here.
        </p>

        <div>
          <Label htmlFor="sender-name">Display name</Label>
          <Input
            id="sender-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Jamie at Blackwellen Roofing"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="sender-footer" required>
            Postal address
          </Label>
          <textarea
            id="sender-footer"
            rows={3}
            value={postalFooter}
            onChange={(event) => setPostalFooter(event.target.value)}
            placeholder="Blackwellen Roofing Ltd, 12 Example Road, Bournemouth, BH1 1AA"
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-content focus:border-accent-400 focus:outline-none"
          />
          {/* Not a preference. A cold marketing email that does not identify
              the sender and give a physical address is not lawful to send. */}
          <p className="mt-1.5 text-[12px] leading-relaxed text-content-muted">
            Required. Cold marketing email must identify who is writing and give a
            physical address.
          </p>
        </div>

        <div>
          <Label htmlFor="sender-signature">Signature</Label>
          <textarea
            id="sender-signature"
            rows={2}
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-content focus:border-accent-400 focus:outline-none"
          />
        </div>

        <div>
          <Label htmlFor="sender-cap">Daily send limit</Label>
          <Input
            id="sender-cap"
            type="number"
            min={1}
            max={500}
            value={dailyCap}
            onChange={(event) => setDailyCap(Number(event.target.value) || 1)}
            className="mt-1"
          />
          <p className="mt-1.5 text-[12px] text-content-muted">
            A new sending domain should start low and build up. This cap is enforced
            per day across every campaign.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={displayName.trim().length === 0 || postalFooter.trim().length < 10}
          >
            Save identity
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- campaign */

function CampaignDialog({
  senders,
  onClose,
}: {
  senders: SenderIdentityRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [senderId, setSenderId] = React.useState(senders[0]?.id ?? "");
  const [minimumGrade, setMinimumGrade] = React.useState<(typeof GRADES)[number]>("B");
  const [dailyCap, setDailyCap] = React.useState(50);
  const [perRun, setPerRun] = React.useState(25);
  const [review, setReview] = React.useState(true);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await createCampaignAction({
        name,
        senderIdentityId: senderId,
        minimumGrade,
        dailyContactCap: dailyCap,
        prospectsPerRun: perRun,
        reviewBeforeOutreach: review,
        subject,
        body,
      });

      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }

      toast({
        variant: "success",
        title: "Campaign created as a draft.",
        description: "Review it, then launch when you are ready to start sending.",
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal open onClose={onClose} title="New acquisition campaign" size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="campaign-name" required>
              Campaign name
            </Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Commercial roofing — Dorset"
              className="mt-1"
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="campaign-sender">Send from</Label>
            <Select
              id="campaign-sender"
              value={senderId}
              onChange={(event) => setSenderId(event.target.value)}
              className="mt-1"
            >
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {sender.displayName} · {sender.email}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="campaign-grade">Minimum grade</Label>
            <Select
              id="campaign-grade"
              value={minimumGrade}
              onChange={(event) =>
                setMinimumGrade(event.target.value as (typeof GRADES)[number])
              }
              className="mt-1"
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="campaign-daily">Daily contact cap</Label>
            <Input
              id="campaign-daily"
              type="number"
              min={1}
              max={500}
              value={dailyCap}
              onChange={(event) => setDailyCap(Number(event.target.value) || 1)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="campaign-per-run">Prospects per batch</Label>
            <Input
              id="campaign-per-run"
              type="number"
              min={1}
              max={200}
              value={perRun}
              onChange={(event) => setPerRun(Number(event.target.value) || 1)}
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="campaign-subject" required>
            Subject
          </Label>
          <Input
            id="campaign-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Roof maintenance at {{company_name}}"
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="campaign-body" required>
            Message
          </Label>
          <textarea
            id="campaign-body"
            rows={7}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              "Hi {{first_name}},\n\nI noticed {{company_name}} manages several commercial buildings in the area...\n"
            }
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-content focus:border-accent-400 focus:outline-none"
          />
          <p className="mt-1.5 flex gap-1.5 text-[12px] leading-relaxed text-content-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Available fields:{" "}
              <code className="rounded bg-surface-sunken px-1">{"{{first_name}}"}</code>,{" "}
              <code className="rounded bg-surface-sunken px-1">{"{{company_name}}"}</code>,{" "}
              <code className="rounded bg-surface-sunken px-1">{"{{role}}"}</code>,{" "}
              <code className="rounded bg-surface-sunken px-1">{"{{business_name}}"}</code>.
              Your signature, postal address and an unsubscribe link are added
              automatically.
            </span>
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-surface-sunken px-3.5 py-3">
          <Switch
            checked={review}
            onCheckedChange={setReview}
            label="Review before outreach"
            tone="success"
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-content">
              Review every prospect before sending
            </p>
            <p className="text-[11.5px] leading-snug text-content-muted">
              {review
                ? "Nothing is sent automatically. Prospects wait for your approval."
                : "Approved prospects added to this campaign are contacted automatically, subject to caps and contactability."}
            </p>
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-content-muted">
          This creates a draft. Nothing is sent until you launch it, and every
          recipient is re-checked for contactability immediately before their
          message goes out.{" "}
          <Link
            href="/privacy"
            className="font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Data and privacy
          </Link>
        </p>

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={
              !senderId ||
              name.trim().length === 0 ||
              subject.trim().length === 0 ||
              body.trim().length < 20
            }
          >
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
