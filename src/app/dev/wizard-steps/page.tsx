import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevShell } from "@/components/dev/dev-shell";
import { WizardStepsHarness } from "@/components/reactivation/wizard/dev-harness";

export const metadata: Metadata = { title: "Wizard steps preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for Steps 2 and 3 of the reactivation
 * wizard.
 *
 * The full wizard cannot reach these steps without a database, because Step 1
 * will not clear until the server returns at least one eligible contact. This
 * renders the same step components directly against a fixed audience estimate
 * so the layouts can be checked:
 *
 *   /dev/wizard-steps?step=2
 *   /dev/wizard-steps?step=2&channel=email
 *   /dev/wizard-steps?step=3&channel=email
 *
 * It 404s outside development and is never linked from the product.
 */
export default async function WizardStepsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <DevShell>
        <WizardStepsHarness
          step={one("step") === "3" ? 3 : 2}
          channel={one("channel") === "email" ? "email" : "sms"}
        />
    </DevShell>
  );
}
