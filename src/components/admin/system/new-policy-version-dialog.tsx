"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, FormField } from "@/components/ui/form";
import { createPolicyVersion } from "@/lib/admin/compliance-actions";
import {
  POLICY_CHANNELS,
  POLICY_CHANNEL_LABEL,
  type PolicyChannel,
} from "@/lib/admin/compliance-types";

/**
 * Authoring a compliance policy version.
 *
 * `createPolicyVersion` existed and nothing called it. The consequence was
 * narrow and serious: the versioned pack that every send decision is checked
 * against could be *published* and *archived* from this screen, but could only
 * be **created** by inserting a row into `compliance_policy_versions` by hand.
 * A compliance change therefore required database access, which puts the one
 * artefact a regulator would ask to see outside the product that enforces it.
 *
 * Two properties of the underlying action are surfaced here rather than
 * hidden, because they are the reason the model works:
 *
 *   * **A new version always starts as a draft.** Nothing reaches the send path
 *     until somebody publishes it, which is a separate, separately-audited act.
 *   * **Copying from an existing version is the normal path.** A published pack
 *     is never edited — changing a live rule means creating a new version — so
 *     starting from the current one is how an operator makes a small change
 *     without retyping the rules that are not changing. Starting blank is
 *     offered, but it is the unusual choice, and the hint says so.
 */

export type PolicyVersionOption = {
  id: string;
  version: string;
  name: string;
  status: string;
};

/**
 * Every channel the policy vocabulary defines, read from the catalogue rather
 * than listed again here -- a second list would offer a channel the engine does
 * not know, or omit one it does.
 *
 * Worth being exact about what this field is: `loadActivePacks` selects
 * `version, name, country_codes, rules_json` and **does not read the `channels`
 * column at all**. Pack selection is by country; the per-channel rules live
 * inside `rules_json` under `cold`, `warm` and `quiet_hours`. So this is a
 * label describing the pack's scope for whoever reads the list later, not a
 * matching key. Saying otherwise in the hint would teach an operator that
 * ticking a box here changes what the engine enforces, which it does not.
 */
const CHANNELS: readonly PolicyChannel[] = POLICY_CHANNELS;

export function NewPolicyVersionDialog({
  existing,
  onSubmit,
  pending,
}: {
  existing: PolicyVersionOption[];
  /** Runs through `useAdminAction`, so step-up and audit are handled there. */
  onSubmit: (input: Parameters<typeof createPolicyVersion>[0]) => void;
  pending: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [version, setVersion] = React.useState("");
  const [name, setName] = React.useState("");
  const [countries, setCountries] = React.useState("GB");
  const [channels, setChannels] = React.useState<PolicyChannel[]>([]);
  const [basedOn, setBasedOn] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Offered as a starting point only where there is something worth copying.
  const copyable = existing.filter((row) => row.status !== "ARCHIVED");

  function reset() {
    setVersion("");
    setName("");
    setCountries("GB");
    setChannels([]);
    setBasedOn("");
    setNotes("");
    setError(null);
  }

  function submit() {
    const trimmedVersion = version.trim();
    const trimmedName = name.trim();

    // Checked here so the operator is told immediately, and again on the
    // server, which is where it is enforced. The client copy is a courtesy.
    if (trimmedVersion.length < 2 || trimmedName.length < 2) {
      setError("Give the version a number and a name.");
      return;
    }

    const codes = countries
      .split(/[,\s]+/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);

    if (codes.some((code) => code.length !== 2)) {
      setError("Country codes are two letters each, for example GB, IE.");
      return;
    }

    onSubmit({
      version: trimmedVersion,
      name: trimmedName,
      countryCodes: codes,
      channels,
      notes: notes.trim() || undefined,
      basedOnVersionId: basedOn || undefined,
    });

    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <Plus className="size-3.5" aria-hidden />
        New version
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="New policy version"
        description="Created as a draft. Nothing it says affects a send until it is published."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              Create draft
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Version"
              htmlFor="policy-version"
              required
              hint="Operator-chosen, for example v2.4. Must be unique."
            >
              <Input
                id="policy-version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="v2.4"
                maxLength={24}
              />
            </FormField>

            <FormField label="Name" htmlFor="policy-name" required>
              <Input
                id="policy-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="UK direct marketing"
                maxLength={120}
              />
            </FormField>
          </div>

          <FormField
            label="Start from"
            htmlFor="policy-based-on"
            hint={
              copyable.length > 0
                ? "A published pack is never edited — a change means a new version. Copying the current one is the usual path."
                : "There is nothing to copy yet, so this pack starts empty."
            }
          >
            <Select
              id="policy-based-on"
              value={basedOn}
              onChange={(event) => setBasedOn(event.target.value)}
              disabled={copyable.length === 0}
            >
              <option value="">Empty pack</option>
              {copyable.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.version} · {row.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Countries"
            htmlFor="policy-countries"
            hint="Two-letter codes, comma separated. Left blank, this becomes the fallback pack used for any country without one of its own."
          >
            <Input
              id="policy-countries"
              value={countries}
              onChange={(event) => setCountries(event.target.value)}
              placeholder="GB, IE"
            />
          </FormField>

          <FormField
            label="Channels"
            hint="A label recording which channels this pack was written for. The rules themselves live in the pack body — the engine selects a pack by country, not by this list."
          >
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((channel) => {
                const selected = channels.includes(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setChannels((current) =>
                        current.includes(channel)
                          ? current.filter((value) => value !== channel)
                          : [...current, channel],
                      )
                    }
                    className={
                      selected
                        ? "rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-[12.5px] font-medium text-content"
                        : "rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] text-content-secondary hover:bg-surface-hover"
                    }
                  >
                    {POLICY_CHANNEL_LABEL[channel] ?? channel}
                  </button>
                );
              })}
            </div>
          </FormField>

          <FormField
            label="Notes"
            htmlFor="policy-notes"
            hint="Why this version exists. Read by whoever has to explain a past decision."
          >
            <Textarea
              id="policy-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={4000}
              placeholder="What changed, and what prompted it."
            />
          </FormField>

          {error && (
            <p role="alert" className="text-[12.5px] text-danger-600">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
