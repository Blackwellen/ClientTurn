"use client";

import * as React from "react";
import { recordHelpArticleView } from "@/lib/help/actions";

/** Counts one view per article per page load. Renders nothing. */
export function HelpViewBeacon({ slug }: { slug: string }) {
  React.useEffect(() => {
    void recordHelpArticleView(slug).catch(() => undefined);
  }, [slug]);
  return null;
}
