"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/tabs";
import { FOLLOW_UP_VIEW_META, type FollowUpViewValue } from "@/lib/follow-up/types";

/**
 * Toggles between the Follow-Up, Qualification and LinkedIn Assist views. State lives in the
 * `view` search param — never local state — so the active view is linkable,
 * bookmarkable, and browser back/forward moves between them.
 */
export function SegmentedViewSwitch({ value }: { value: FollowUpViewValue }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  function update(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "follow-up") params.delete("view");
    else params.set("view", next);
    // Switching views leaves the other view's sub-filters behind.
    params.delete("sequence");
    params.delete("service");
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <SegmentedControl
      accent
      label="View"
      // Three segments: scroll rather than overflow the page on a phone.
      className="max-w-full overflow-x-auto"
      value={value}
      onChange={update}
      items={[
        { value: "follow-up", label: FOLLOW_UP_VIEW_META["follow-up"].label },
        { value: "qualification", label: FOLLOW_UP_VIEW_META.qualification.label },
        { value: "linkedin", label: FOLLOW_UP_VIEW_META.linkedin.label },
      ]}
    />
  );
}
