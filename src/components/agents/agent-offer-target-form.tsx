"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { saveAgentOfferTarget } from "@/lib/agents/actions";
import type { CatalogueOptions, OfferTarget } from "@/lib/agents/offer-target";
import { OfferTargetPicker } from "./offer-target-picker";

/** The agent's Settings tab: what it sells, saved through `agent.set_offer_target`. */
export function AgentOfferTargetForm({
  agentId,
  target,
  catalogue,
}: {
  agentId: string;
  target: OfferTarget;
  catalogue: CatalogueOptions;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = React.useState<OfferTarget>(target);
  const [error, setError] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(target);

  function save() {
    if (value.scope === "SELECTED" && value.serviceIds.length + value.catalogueItemIds.length === 0) {
      setError("Choose at least one product or service, or pick the whole catalogue.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await saveAgentOfferTarget({ id: agentId, ...value });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast({ variant: "success", title: `Saved. Now sells: ${result.summary}.` });
        router.refresh();
      } catch {
        setError("That could not be saved. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <OfferTargetPicker value={value} onChange={setValue} catalogue={catalogue} disabled={pending} />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        {dirty && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setValue(target)}>
            Undo changes
          </Button>
        )}
        <Button size="sm" loading={pending} disabled={!dirty} onClick={save}>
          Save what it sells
        </Button>
      </div>
    </div>
  );
}
