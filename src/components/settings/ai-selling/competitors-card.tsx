"use client";

import * as React from "react";
import { Pencil, Plus, Swords, Trash2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField, Input, Switch, Textarea } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  MAX_APPROVED_POINTS,
  MAX_COMPETITORS,
  MAX_NEVER_SAY,
  type Competitor,
} from "@/lib/sales-library/competitors";
import { removeCompetitorAction, saveCompetitorAction } from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

/**
 * Competitors (commercial rules, 0174): the competitors leads mention, the
 * factual comparison points the business approves, and the lines never to
 * say. When a lead names one, the assistant may use an approved point word for
 * word, and nothing else; every reply is checked, and a put-down or an
 * unapproved claim about a competitor is refused before it is sent.
 */

type Draft = {
  isNew: boolean;
  id: string;
  name: string;
  aliases: string;
  approvedPoints: string;
  neverSay: string;
  enabled: boolean;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function toDraft(competitor: Competitor | null): Draft {
  if (!competitor) return { isNew: true, id: "", name: "", aliases: "", approvedPoints: "", neverSay: "", enabled: true };
  return {
    isNew: false,
    id: competitor.id,
    name: competitor.name,
    aliases: competitor.aliases.join(", "),
    approvedPoints: competitor.approvedPoints.join("\n"),
    neverSay: competitor.neverSay.join("\n"),
    enabled: competitor.enabled,
  };
}

export function CompetitorsCard({
  competitors,
  invalid,
  schemaReady,
  canManage,
}: {
  competitors: Competitor[];
  invalid: number;
  schemaReady: boolean;
  canManage: boolean;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [removing, setRemoving] = React.useState<Competitor | null>(null);
  const [localError, setLocalError] = React.useState("");
  const { save, saving } = useSettingsSave();
  const locked = !canManage || saving || !schemaReady;

  async function onSave() {
    if (!draft) return;
    const id = draft.isNew ? slugify(draft.name) : draft.id;
    if (!id || draft.name.trim().length < 2) {
      setLocalError("Give the competitor a name.");
      return;
    }
    if (lines(draft.approvedPoints).length > MAX_APPROVED_POINTS) {
      setLocalError(`Keep to ${MAX_APPROVED_POINTS} approved points.`);
      return;
    }
    if (lines(draft.neverSay).length > MAX_NEVER_SAY) {
      setLocalError(`Keep to ${MAX_NEVER_SAY} never-say lines.`);
      return;
    }
    setLocalError("");
    const ok = await save(() =>
      saveCompetitorAction({
        competitor: {
          id,
          name: draft.name.trim(),
          aliases: draft.aliases.split(",").map((a) => a.trim()).filter(Boolean),
          approvedPoints: lines(draft.approvedPoints),
          neverSay: lines(draft.neverSay),
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
          icon={Swords}
          title="Competitors"
          description="The competitors your leads mention, what you can factually say about them, and what never to say. When a lead names one, the assistant may use an approved point word for word and nothing else. It never criticises a competitor."
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {!schemaReady && (
          <p role="status" className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-[12.5px] text-warning-700">
            Competitors are not available until the latest database update is applied.
          </p>
        )}
        {invalid > 0 && (
          <p role="alert" className="text-[12.5px] text-warning-700">
            {invalid} saved {invalid === 1 ? "competitor is" : "competitors are"} not valid and {invalid === 1 ? "is" : "are"} being
            ignored. Remove and add {invalid === 1 ? "it" : "them"} again.
          </p>
        )}

        {competitors.length === 0 && !draft ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-[13px] text-content-muted">
            No competitors listed. If a lead mentions one, the assistant says nothing about them and talks about what you
            offer. Add the ones you hear about, with points you can stand behind.
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {competitors.map((competitor) => (
              <li key={competitor.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-content">{competitor.name}</span>
                    {!competitor.enabled && <Badge tone="neutral">Off</Badge>}
                    <Badge tone={competitor.approvedPoints.length ? "success" : "neutral"}>
                      {competitor.approvedPoints.length} approved {competitor.approvedPoints.length === 1 ? "point" : "points"}
                    </Badge>
                  </div>
                  {competitor.aliases.length > 0 && (
                    <p className="text-[12px] text-content-subtle">Also known as: {competitor.aliases.join(", ")}</p>
                  )}
                  {competitor.approvedPoints[0] && (
                    <p className="line-clamp-2 text-[12.5px] text-content-muted">{competitor.approvedPoints[0]}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <IconButton label={`Edit ${competitor.name}`} size="sm" variant="ghost" disabled={locked} onClick={() => setDraft(toDraft(competitor))}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label={`Remove ${competitor.name}`} size="sm" variant="ghost" disabled={locked} onClick={() => setRemoving(competitor)}>
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
              <h3 className="text-[13.5px] font-medium text-content">{draft.isNew ? "Add a competitor" : `Edit: ${draft.name}`}</h3>
              <IconButton label="Close the editor" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Name" htmlFor="competitor-name" required>
                <Input
                  id="competitor-name"
                  maxLength={80}
                  disabled={locked || !draft.isNew}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </FormField>
              <FormField label="Also known as" htmlFor="competitor-aliases" hint="Optional, comma separated: other names leads use.">
                <Input
                  id="competitor-aliases"
                  disabled={locked}
                  value={draft.aliases}
                  onChange={(event) => setDraft({ ...draft, aliases: event.target.value })}
                />
              </FormField>
            </div>
            <FormField
              label="Approved comparison points"
              htmlFor="competitor-points"
              hint={`One per line, up to ${MAX_APPROVED_POINTS}. Factual, verifiable, and naming the competitor, e.g. "Unlike Acme, onboarding is included in every plan." Used word for word.`}
            >
              <Textarea
                id="competitor-points"
                rows={4}
                disabled={locked}
                value={draft.approvedPoints}
                onChange={(event) => setDraft({ ...draft, approvedPoints: event.target.value })}
              />
            </FormField>
            <FormField label="Never say" htmlFor="competitor-never" hint={`One per line, up to ${MAX_NEVER_SAY}. Any reply containing one is refused.`}>
              <Textarea
                id="competitor-never"
                rows={3}
                disabled={locked}
                value={draft.neverSay}
                onChange={(event) => setDraft({ ...draft, neverSay: event.target.value })}
              />
            </FormField>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] text-content">
                <Switch checked={draft.enabled} disabled={locked} label="Use this competitor" onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
                Use this competitor
              </label>
              <Button size="sm" loading={saving} disabled={locked} onClick={onSave}>
                Save competitor
              </Button>
            </div>
            {localError && (
              <p role="alert" className="text-[12.5px] text-danger-600">
                {localError}
              </p>
            )}
          </div>
        )}

        {canManage && !draft && (
          <Button
            variant="secondary"
            size="sm"
            disabled={locked || competitors.length >= MAX_COMPETITORS}
            onClick={() => setDraft(toDraft(null))}
          >
            <Plus className="size-4" aria-hidden />
            Add a competitor
          </Button>
        )}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing;
          setRemoving(null);
          if (target) await save(() => removeCompetitorAction({ id: target.id }));
        }}
        title={removing ? `Remove "${removing.name}"?` : "Remove competitor?"}
        scope="The assistant stops recognising this competitor and loses its approved points."
        consequence="If a lead mentions them, the assistant says nothing about them. The never-say lines stop being checked."
        confirmLabel="Remove"
        variant="danger"
        loading={saving}
      />
    </Card>
  );
}
