"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { addLeadInterestAction } from "@/lib/leads/detail-actions";

/** "Add an interest": another service this lead wants, as its own opportunity (08 §B.20). */
export function AddInterestForm({ leadId, services }: { leadId: string; services: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serviceId, setServiceId] = React.useState("");
  const [pending, setPending] = React.useState(false);

  if (services.length === 0) return null;

  async function add() {
    if (!serviceId) return;
    setPending(true);
    try {
      const result = await addLeadInterestAction({ leadId, serviceId });
      if (result.ok) {
        toast({ variant: "success", title: result.message ?? "Interest added." });
        setServiceId("");
        router.refresh();
      } else {
        toast({ variant: "error", title: result.error });
      }
    } catch {
      toast({ variant: "error", title: "That could not be saved. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-line-subtle px-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor="add-interest" className="mb-1 block text-[12px] font-medium text-content-muted">
          Add an interest
        </label>
        <Select
          id="add-interest"
          value={serviceId}
          placeholder="Choose a service"
          onValueChange={setServiceId}
          options={services.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>
      <Button size="sm" variant="secondary" onClick={add} loading={pending} disabled={!serviceId || pending}>
        <Plus className="size-3.5" aria-hidden />
        Add
      </Button>
    </div>
  );
}
