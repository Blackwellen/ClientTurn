"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { MessageSquareWarning, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/ui/modal";
import { OBJECTIONS } from "@/lib/sales-library/objections";
import { OBJECTION_KEYS } from "@/lib/sales-library/types";
import {
  REASSURANCE_KINDS,
  REASSURANCE_KIND_LABEL,
  type ReassuranceAsset,
  type ReassuranceKind,
  type WorkspaceObjection,
  type WorkspaceObjectionSet,
} from "@/lib/sales-library/workspace-objections";
import type { ObjectionPreview } from "@/lib/agent/objection-preview";
import {
  previewObjectionAction,
  removeObjectionAction,
  saveObjectionAction,
  saveReassuranceAction,
} from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

/**
 * Objections (elite-closer brief): the objections this business hears most,
 * its own best answers, and the reassurance it stands behind. The assistant
 * prefers these to its generic playbook, may paraphrase them, and never adds
 * to them. "Try it" runs a message through the real matcher, plan and
 * validator offline, with an example reply, and spends nothing.
 */

type Draft = {
  key: string;
  isNew: boolean;
  source: "LIBRARY" | "CUSTOM";
  libraryKey: string;
  customSlug: string;
  label: string;
  phrases: string;
  response: string;
  reassuranceIds: string[];
  enabled: boolean;
};

const LIBRARY_OPTIONS = OBJECTION_KEYS.filter((key) => !OBJECTIONS[key].respectAsRefusal && !OBJECTIONS[key].handover.always);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function toDraft(objection: WorkspaceObjection | null): Draft {
  if (!objection) {
    return {
      key: "",
      isNew: true,
      source: "LIBRARY",
      libraryKey: "PRICE",
      customSlug: "",
      label: OBJECTIONS.PRICE.label,
      phrases: "",
      response: "",
      reassuranceIds: [],
      enabled: true,
    };
  }
  return {
    key: objection.key,
    isNew: false,
    source: objection.libraryKey ? "LIBRARY" : "CUSTOM",
    libraryKey: objection.libraryKey ?? "PRICE",
    customSlug: objection.key.replace(/^custom:/, ""),
    label: objection.label,
    phrases: objection.phrases.join("\n"),
    response: objection.response,
    reassuranceIds: objection.reassuranceIds,
    enabled: objection.enabled,
  };
}

export function ObjectionsCard({ set, canManage }: { set: WorkspaceObjectionSet; canManage: boolean }) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [removing, setRemoving] = React.useState<{ key: string; label: string } | null>(null);
  const { save, saving } = useSettingsSave();
  const locked = !canManage || saving;

  async function onSaveDraft() {
    if (!draft) return;
    const key = draft.source === "LIBRARY" ? draft.libraryKey : `custom:${slugify(draft.customSlug || draft.label)}`;
    const ok = await save(() =>
      saveObjectionAction({
        key,
        payload: {
          label: draft.label.trim(),
          phrases: draft.phrases.split(/\r?\n/).map((p) => p.trim()).filter(Boolean),
          response: draft.response.trim(),
          reassuranceIds: draft.reassuranceIds,
          enabled: draft.enabled,
        },
      }),
    );
    if (ok) setDraft(null);
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={MessageSquareWarning}
          title="Objections"
          description="The objections you hear most and your own best answers. The assistant uses your answer before its general playbook, may put it in its own words, and never adds a claim to it."
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {set.invalid.length > 0 && (
          <p role="alert" className="text-[12.5px] text-warning-700">
            {set.invalid.length} saved {set.invalid.length === 1 ? "entry is" : "entries are"} not valid and {set.invalid.length === 1 ? "is" : "are"} being ignored:{" "}
            {set.invalid.join(", ")}. Edit or remove {set.invalid.length === 1 ? "it" : "them"}.
          </p>
        )}

        {set.objections.length === 0 && !draft ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-[13px] text-content-muted">
            No objections of your own yet. The assistant uses its general playbook for price, timing, trust, competitors and
            the rest. Add the ones you hear most, with the answer that works for you.
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {set.objections.map((objection) => (
              <li key={objection.key} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-content">{objection.label}</span>
                    <Badge tone={objection.libraryKey ? "info" : "purple"}>
                      {objection.libraryKey ? `Refines: ${OBJECTIONS[objection.libraryKey].label}` : "Your own"}
                    </Badge>
                    {!objection.enabled && <Badge tone="neutral">Off</Badge>}
                  </div>
                  <p className="line-clamp-2 text-[12.5px] text-content-muted">{objection.response}</p>
                  {objection.phrases.length > 0 && (
                    <p className="text-[12px] text-content-subtle">Heard as: {objection.phrases.join(" · ")}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <IconButton label={`Edit ${objection.label}`} size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(toDraft(objection))}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Remove ${objection.label}`}
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setRemoving({ key: objection.key, label: objection.label })}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {draft && (
          <div className="space-y-4 rounded-lg border border-line bg-surface-subtle p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13.5px] font-medium text-content">{draft.isNew ? "Add an objection" : `Edit: ${draft.label}`}</h3>
              <IconButton label="Close the editor" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Type" htmlFor="objection-source" hint="Refine a common objection, or add one only your business hears.">
                <Select
                  id="objection-source"
                  value={draft.source}
                  disabled={locked || !draft.isNew}
                  onChange={(event) => setDraft({ ...draft, source: event.target.value as Draft["source"] })}
                >
                  <option value="LIBRARY">A common objection</option>
                  <option value="CUSTOM">One only we hear</option>
                </Select>
              </FormField>
              {draft.source === "LIBRARY" ? (
                <FormField label="Objection" htmlFor="objection-library">
                  <Select
                    id="objection-library"
                    value={draft.libraryKey}
                    disabled={locked || !draft.isNew}
                    onChange={(event) => {
                      const key = event.target.value as (typeof OBJECTION_KEYS)[number];
                      setDraft({ ...draft, libraryKey: key, label: OBJECTIONS[key].label });
                    }}
                  >
                    {LIBRARY_OPTIONS.map((key) => (
                      <option key={key} value={key}>
                        {OBJECTIONS[key].label}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : (
                <FormField label="Name" htmlFor="objection-label" hint="What your team calls it, e.g. Mid-rebrand.">
                  <Input
                    id="objection-label"
                    maxLength={80}
                    disabled={locked}
                    value={draft.label}
                    onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                  />
                </FormField>
              )}
            </div>
            <FormField
              label="How leads say it"
              htmlFor="objection-phrases"
              hint={draft.source === "CUSTOM" ? "One per line. At least one, so the assistant can recognise it." : "Optional, one per line. The common phrasings are already recognised."}
            >
              <Textarea
                id="objection-phrases"
                rows={3}
                disabled={locked}
                value={draft.phrases}
                onChange={(event) => setDraft({ ...draft, phrases: event.target.value })}
              />
            </FormField>
            <FormField
              label="Your best answer"
              htmlFor="objection-response"
              hint="Only what you can stand behind. No emojis, no dashes and no deadlines or pressure: the assistant will not send them."
            >
              <Textarea
                id="objection-response"
                rows={4}
                maxLength={600}
                disabled={locked}
                value={draft.response}
                onChange={(event) => setDraft({ ...draft, response: event.target.value })}
              />
            </FormField>
            {set.assets.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-[13px] font-medium text-content">Reassurance to lean on</legend>
                <div className="flex flex-wrap gap-3">
                  {set.assets.map((asset) => (
                    <label key={asset.id} className="flex items-center gap-2 text-[12.5px] text-content-muted">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        disabled={locked}
                        checked={draft.reassuranceIds.includes(asset.id)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            reassuranceIds: event.target.checked
                              ? [...draft.reassuranceIds, asset.id].slice(0, 5)
                              : draft.reassuranceIds.filter((id) => id !== asset.id),
                          })
                        }
                      />
                      {REASSURANCE_KIND_LABEL[asset.kind]}: {asset.text.slice(0, 48)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              disabled={locked}
              label="The assistant uses this answer"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={locked || !draft.response.trim() || !draft.label.trim()}
                onClick={onSaveDraft}
              >
                Save objection
              </Button>
            </div>
          </div>
        )}

        <ReassuranceEditor assets={set.assets} canManage={canManage} />
        <TryIt />
      </CardContent>
      {canManage && !draft && (
        <CardFooter className="justify-end">
          <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(null))}>
            <Plus className="size-4" /> Add an objection
          </Button>
        </CardFooter>
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing;
          setRemoving(null);
          if (target) await save(() => removeObjectionAction({ key: target.key }));
        }}
        title={removing ? `Remove "${removing.label}"?` : "Remove objection?"}
        scope="The agent stops recognising this objection and stops using your response to it."
        consequence="Your custom wording is deleted. You can add the objection again from the library."
        confirmLabel="Remove"
        variant="danger"
        loading={saving}
      />
    </Card>
  );
}

function ReassuranceEditor({ assets, canManage }: { assets: ReassuranceAsset[]; canManage: boolean }) {
  const [items, setItems] = React.useState<ReassuranceAsset[]>(assets);
  const { save, saving } = useSettingsSave();
  const dirty = JSON.stringify(items) !== JSON.stringify(assets);
  const locked = !canManage || saving;

  return (
    <section className="space-y-3" aria-labelledby="reassurance-heading">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-content-muted" aria-hidden />
        <h3 id="reassurance-heading" className="text-[13.5px] font-medium text-content">
          Reassurance you stand behind
        </h3>
      </div>
      <p className="text-[12.5px] text-content-muted">
        Service levels, guarantees, case studies, testimonials you own and response-time commitments. The assistant
        quotes these as written, or not at all. Add only what is true and yours to use.
      </p>
      {items.length === 0 && <p className="text-[12.5px] text-content-subtle">None yet.</p>}
      {items.map((item, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[11rem_1fr_auto]">
          <Select
            aria-label="Kind"
            value={item.kind}
            disabled={locked}
            onChange={(event) =>
              setItems(items.map((it, i) => (i === index ? { ...it, kind: event.target.value as ReassuranceKind } : it)))
            }
          >
            {REASSURANCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {REASSURANCE_KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Reassurance"
            maxLength={300}
            disabled={locked}
            value={item.text}
            onChange={(event) => setItems(items.map((it, i) => (i === index ? { ...it, text: event.target.value } : it)))}
          />
          {canManage && (
            <IconButton label="Remove this reassurance" size="sm" variant="ghost" disabled={locked} onClick={() => setItems(items.filter((_, i) => i !== index))}>
              <X className="size-4" />
            </IconButton>
          )}
        </div>
      ))}
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || items.length >= 20}
            onClick={() => setItems([...items, { id: `r${Date.now().toString(36)}`, kind: "CASE_STUDY", text: "", source: null }])}
          >
            <Plus className="size-4" /> Add reassurance
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={locked || !dirty || items.some((item) => !item.text.trim())}
            onClick={() =>
              save(() =>
                saveReassuranceAction({ assets: items.map((item) => ({ ...item, id: slugify(item.id) || "r", text: item.text.trim() })) }),
              )
            }
          >
            Save reassurance
          </Button>
        </div>
      )}
    </section>
  );
}

function TryIt() {
  const [message, setMessage] = React.useState("");
  const [channel, setChannel] = React.useState<"sms" | "whatsapp" | "email">("sms");
  const [result, setResult] = React.useState<ObjectionPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await previewObjectionAction({ message, channel });
      if (response.ok && response.data) setResult(response.data);
      else setError(response.ok ? "No preview came back." : response.error);
    } catch {
      setError("The preview could not run. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-line p-4" aria-labelledby="try-it-heading">
      <h3 id="try-it-heading" className="text-[13.5px] font-medium text-content">
        Try it
      </h3>
      <p className="text-[12.5px] text-content-muted">
        Type what a lead might say. This runs offline through the same matching, plan and checks the assistant uses, with
        an example reply. It spends no AI tokens.
      </p>
      <div className="grid gap-2 md:grid-cols-[1fr_9rem_auto]">
        <Input aria-label="What the lead says" maxLength={600} value={message} placeholder="Honestly it feels a bit expensive" onChange={(event) => setMessage(event.target.value)} />
        <Select aria-label="Channel" value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </Select>
        <Button size="sm" loading={pending} disabled={!message.trim()} onClick={run}>
          Try it
        </Button>
      </div>
      <FormError message={error} />
      {result && (
        <div className="space-y-2 text-[12.5px]" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.source === "WORKSPACE" ? "success" : result.source === "LIBRARY" ? "info" : "neutral"}>
              {result.source === "WORKSPACE" ? "Your answer" : result.source === "LIBRARY" ? "General playbook" : "No objection recognised"}
            </Badge>
            {result.libraryLabel && <span className="text-content-muted">Recognised as: {result.libraryLabel}</span>}
            {result.handsOver && <Badge tone="warning">A person answers this one</Badge>}
            <span className="text-content-subtle">Reply quality {result.grade}/100</span>
          </div>
          <p className="rounded-md bg-surface-subtle p-3 text-content">
            <span className="block text-[11.5px] uppercase tracking-wide text-content-subtle">Example reply</span>
            {result.exampleReply}
          </p>
          {result.problems.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-warning-700">
              {result.problems.map((problem, index) => (
                <li key={index}>{problem.detail}</li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-content-muted">What the assistant is told</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-subtle p-3 text-[12px] text-content-muted">{result.strategyText}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
