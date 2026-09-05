"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/leads/actions";

/**
 * For providers connected with a customer-generated token rather than an
 * OAuth redirect (currently only HubSpot's private-app token).
 */
export function TokenConnectDialog({
  open,
  providerName,
  helpUrl,
  onClose,
  onSubmit,
}: {
  open: boolean;
  providerName: string;
  helpUrl: string;
  onClose: () => void;
  onSubmit: (token: string) => Promise<ActionResult>;
}) {
  const { toast } = useToast();
  const [token, setToken] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await onSubmit(token.trim());
      if (result.ok) {
        toast({ variant: "success", title: `${providerName} connected.` });
        setToken("");
        onClose();
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Connect ${providerName}`} size="sm">
      <form onSubmit={submit} className="space-y-3.5">
        <p className="text-content-muted text-[13px]">
          Generate a private app token in your {providerName} account, then
          paste it here. Client Turn stores it encrypted and only your
          workspace can use it.{" "}
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-content-accent underline"
          >
            How to generate one
          </a>
        </p>

        <FormField label="Private app token" htmlFor="provider-token" required>
          <Input
            id="provider-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending} disabled={!token.trim()}>
            Connect
          </Button>
        </div>
      </form>
    </Modal>
  );
}
