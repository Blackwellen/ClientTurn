import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevShell } from "@/components/dev/dev-shell";
import { ReactivationWizard } from "@/components/reactivation/reactivation-wizard";

export const metadata: Metadata = { title: "Reactivation wizard preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for `/app/reactivation/new`.
 *
 * The wizard itself is unchanged — this only supplies the props the real page
 * loads from Supabase, so the three steps can be checked without a session:
 *
 *   /dev/wizard-preview            → step 1, SMS workspace
 *   /dev/wizard-preview?email=1    → email mailbox connected
 *   /dev/wizard-preview?offline=1  → no messaging provider connected
 *
 * It 404s outside development and is never linked from the product.
 */
export default async function WizardPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const flag = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) === "1";
  };

  return (
    <DevShell>
        <div className="space-y-5">
          <ReactivationWizard
            businessName="Blackwellen Roofing & Exteriors"
            options={{
              services: [
                { id: "11111111-1111-4111-8111-111111111111", name: "Roof Repair" },
                { id: "22222222-2222-4222-8222-222222222222", name: "New Roof" },
                { id: "33333333-3333-4333-8333-333333333333", name: "Gutter Cleaning" },
                { id: "44444444-4444-4444-8444-444444444444", name: "Chimney Work" },
              ],
              sources: [
                { id: "55555555-5555-4555-8555-555555555555", label: "Meta Lead Ads" },
                { id: "66666666-6666-4666-8666-666666666666", label: "Website" },
                { id: "77777777-7777-4777-8777-777777777777", label: "Referral" },
              ],
            }}
            defaultChannel={flag("email") ? "email" : "sms"}
            whatsappEnabled
            emailEnabled={flag("email")}
            providerConnected={!flag("offline")}
            quietHours={{
              enabled: true,
              start: "20:00",
              end: "08:00",
              timezone: "Europe/London",
            }}
          />
        </div>
    </DevShell>
  );
}
