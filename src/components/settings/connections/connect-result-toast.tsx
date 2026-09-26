"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { connectResultMessage } from "@/lib/integrations/catalog";

/**
 * Tells the person how the OAuth round trip went.
 *
 * The callback redirects here with `?connected=<provider>` or
 * `?connect=failed`. Shown once, then the parameters are removed so a refresh
 * or a shared link does not announce the same connection again.
 */
export function ConnectResultToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const shown = React.useRef(false);

  React.useEffect(() => {
    if (shown.current) return;
    const message = connectResultMessage({
      connected: params.get("connected"),
      connect: params.get("connect"),
    });
    if (!message) return;
    shown.current = true;
    toast({ ...message, duration: message.variant === "error" ? 9000 : 6000 });

    const next = new URLSearchParams(params.toString());
    next.delete("connected");
    next.delete("connect");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router, toast]);

  return null;
}
