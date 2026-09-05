"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { updateCampaignDetails } from "@/lib/campaigns/actions";
import type { ReactivationCampaignDetail } from "@/lib/campaigns/reactivation-types";

/**
 * The safe subset of a campaign that stays editable after creation. Audience
 * definition, message templates and schedule are deliberately not here:
 * changing them mid-flight would invalidate the results already collected.
 * The server enforces the same limit — this dialog is not the gate.
 */
export function CampaignEditDialog({
  campaign,
  open,
  onClose,
}: {
  campaign: ReactivationCampaignDetail;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState(campaign.name);
  const [description, setDescription] = React.useState(campaign.description ?? "");
  const [audienceLabel, setAudienceLabel] = React.useState(campaign.audienceLabel);
  const [tags, setTags] = React.useState(campaign.tags.join(", "));

  // Re-seed whenever a different campaign is opened, so the form never shows
  // the previous campaign's values.
  const [trackedId, setTrackedId] = React.useState(campaign.id);
  if (trackedId !== campaign.id) {
    setTrackedId(campaign.id);
    setName(campaign.name);
    setDescription(campaign.description ?? "");
    setAudienceLabel(campaign.audienceLabel);
    setTags(campaign.tags.join(", "));
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await updateCampaignDetails({
        id: campaign.id,
        name: name.trim(),
        description: description.trim() || undefined,
        audienceLabel: audienceLabel.trim() || undefined,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 8),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast({ variant: "success", title: "Campaign updated" });
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Edit campaign"
      description="Audience rules, messages and schedule are fixed once a campaign exists — duplicate it to change those."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[13px] text-danger-700"
          >
            {error}
          </p>
        )}

        <div>
          <Label htmlFor="campaign-name" required className="mb-1.5">
            Campaign name
          </Label>
          <Input
            id="campaign-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="campaign-description" className="mb-1.5">Description</Label>
          <Textarea
            id="campaign-description"
            rows={3}
            value={description}
            maxLength={280}
            placeholder="One line on what this campaign is for."
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="campaign-audience-label" className="mb-1.5">Audience name</Label>
          <Input
            id="campaign-audience-label"
            value={audienceLabel}
            maxLength={160}
            onChange={(event) => setAudienceLabel(event.target.value)}
          />
          <p className="mt-1 text-[12px] text-content-subtle">
            The label only. Who is actually contacted is set by the audience
            rules and re-checked before every send.
          </p>
        </div>

        <div>
          <Label htmlFor="campaign-tags" className="mb-1.5">Tags</Label>
          <Input
            id="campaign-tags"
            value={tags}
            placeholder="Seasonal, Roofing, Past Quotes"
            onChange={(event) => setTags(event.target.value)}
          />
          <p className="mt-1 text-[12px] text-content-subtle">
            Comma separated, up to eight.
          </p>
        </div>
      </div>
    </Modal>
  );
}
