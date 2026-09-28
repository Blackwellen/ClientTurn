"use client";

import * as React from "react";
import { Search } from "lucide-react";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import { addressFromLines, identityProblemText, regulatoryProblemText } from "@/lib/voice/settings-ui";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useSettingsSave } from "@/components/settings/ai-selling/use-settings-save";
import { lookupCompaniesHouseAction, saveVoiceSettingsAction, type CompaniesHouseLookup } from "@/lib/voice/actions";
import { Notice, PanelCard, SaveFooter } from "./voice-shared";

/**
 * Business identity: who the AI says it is calling for (OD-1, spoken and
 * given on request), and the business details Twilio reviews before a UK
 * number can be issued. Owners and admins edit; others read. A member sees
 * that the representative's phone and email are set, not what they are (the
 * server redacts them).
 */

type Details = {
  companyNumber?: string;
  websiteUrl?: string;
  registeredAddress?: { line1?: string; line2?: string | null; city?: string; region?: string | null; postcode?: string; country?: string };
  representative?: { firstName?: string | null; lastName?: string | null; phone?: string; workEmail?: string };
};

type Found = Extract<CompaniesHouseLookup, { ok: true }>;

export function IdentityPanel({ view }: { view: VoiceSettingsView }) {
  // One Companies House lookup fills both cards: the legal name here, the
  // company number and registered office in the business details.
  const [found, setFound] = React.useState<Found | null>(null);
  const [legalEntityName, setLegalEntityName] = React.useState(view.settings.legalEntityName ?? view.regulatory.prefill.legalName ?? "");
  function onFound(result: Found) {
    setFound(result);
    if (result.companiesHouse === "FOUND" && result.legalName) {
      setLegalEntityName((current) => current.trim() || result.legalName || "");
    }
  }
  return (
    <>
      <CallerIdentityCard view={view} legalEntityName={legalEntityName} setLegalEntityName={setLegalEntityName} />
      <RegulatoryCard view={view} found={found} onFound={onFound} />
    </>
  );
}

function CallerIdentityCard({
  view,
  legalEntityName,
  setLegalEntityName,
}: {
  view: VoiceSettingsView;
  legalEntityName: string;
  setLegalEntityName: (value: string) => void;
}) {
  const { save, saving } = useSettingsSave();
  const s = view.settings;
  const [callingAsName, setCallingAsName] = React.useState(s.callingAsName ?? "");
  const [contact, setContact] = React.useState(s.identificationContact ?? "");
  const [personaName, setPersonaName] = React.useState(s.personaName ?? "");
  const readOnly = !view.canEdit;
  const missing = !callingAsName.trim() || !legalEntityName.trim() || !contact.trim();

  function onSave() {
    void save(() =>
      saveVoiceSettingsAction({
        identity: {
          callingAsName: callingAsName.trim(),
          legalEntityName: legalEntityName.trim(),
          identificationContact: contact.trim(),
          personaName: personaName.trim() || null,
        },
      }),
    );
  }

  return (
    <PanelCard
      title="Who the AI calls for"
      description="Said at the start of every call, and given to anyone who asks who is calling. Required before voice can be switched on."
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={missing} note={missing ? "Fill in the three required fields." : null} />}
    >
      {!view.identity.ready && view.identity.problems.length > 0 && (
        <Notice tone="warning" role="status">
          <ul className="list-disc space-y-0.5 pl-4">
            {view.identity.problems.map((p) => (
              <li key={p}>{identityProblemText(p)}.</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Calling as" htmlFor="voice-calling-as" required hint="The name the lead knows you by, for example your trading name.">
          <Input id="voice-calling-as" value={callingAsName} maxLength={80} disabled={readOnly} onChange={(e) => setCallingAsName(e.target.value)} />
        </FormField>
        <FormField label="Legal entity" htmlFor="voice-legal-entity" required hint="Your registered company name.">
          <Input id="voice-legal-entity" value={legalEntityName} maxLength={160} disabled={readOnly} onChange={(e) => setLegalEntityName(e.target.value)} />
        </FormField>
        <FormField
          label="Identification contact"
          htmlFor="voice-contact"
          required
          className="sm:col-span-2"
          hint="A postal address, or a UK freephone (0800 or 0808) number, where people can reach you."
        >
          <Input id="voice-contact" value={contact} maxLength={300} disabled={readOnly} onChange={(e) => setContact(e.target.value)} />
        </FormField>
        <FormField label="Assistant name (optional)" htmlFor="voice-persona" hint="A first name the assistant may use. It always says it is an AI.">
          <Input id="voice-persona" value={personaName} maxLength={40} disabled={readOnly} onChange={(e) => setPersonaName(e.target.value)} />
        </FormField>
      </div>
    </PanelCard>
  );
}

function RegulatoryCard({ view, found, onFound }: { view: VoiceSettingsView; found: Found | null; onFound: (found: Found) => void }) {
  const { save, saving } = useSettingsSave();
  const { toast } = useToast();
  const d = (view.regulatory.details ?? {}) as Details;
  const prefill = view.regulatory.prefill;
  const fromLines = prefill.registeredAddress
    ? { line1: prefill.registeredAddress.line1, line2: prefill.registeredAddress.line2 ?? "", city: prefill.registeredAddress.city, postcode: prefill.registeredAddress.postcode }
    : addressFromLines(prefill.address);
  const readOnly = !view.canEdit;

  const [form, setForm] = React.useState({
    companyNumber: d.companyNumber ?? prefill.companyNumber ?? "",
    websiteUrl: d.websiteUrl ?? prefill.website ?? "",
    line1: d.registeredAddress?.line1 ?? fromLines.line1,
    line2: d.registeredAddress?.line2 ?? fromLines.line2,
    city: d.registeredAddress?.city ?? fromLines.city,
    region: d.registeredAddress?.region ?? prefill.registeredAddress?.region ?? "",
    postcode: d.registeredAddress?.postcode ?? fromLines.postcode,
    firstName: d.representative?.firstName ?? "",
    lastName: d.representative?.lastName ?? "",
    phone: readOnly ? "" : (d.representative?.phone ?? ""),
    workEmail: readOnly ? "" : (d.representative?.workEmail ?? ""),
  });
  const [looking, setLooking] = React.useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const required: (keyof typeof form)[] = ["companyNumber", "websiteUrl", "line1", "city", "postcode", "firstName", "lastName", "phone", "workEmail"];
  const incomplete = required.some((k) => !form[k].trim());
  const problems = [...new Set(view.regulatory.problems.map(regulatoryProblemText))];

  async function lookup() {
    setLooking(true);
    try {
      const result = await lookupCompaniesHouseAction();
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      onFound(result);
      if (result.companiesHouse !== "FOUND") return;
      const reg = result.registeredAddress;
      const lines = reg
        ? { line1: reg.line1, line2: reg.line2 ?? "", city: reg.city, region: reg.region ?? "", postcode: reg.postcode }
        : { ...addressFromLines(result.address), region: "" };
      // The register is authoritative for the number and the registered office.
      setForm((f) => ({
        ...f,
        companyNumber: result.companyNumber || f.companyNumber,
        websiteUrl: f.websiteUrl || result.website || "",
        line1: lines.line1 || f.line1,
        line2: lines.line1 ? lines.line2 : f.line2,
        city: lines.city || f.city,
        region: lines.line1 ? lines.region : f.region,
        postcode: lines.postcode || f.postcode,
      }));
      toast({ variant: "success", title: result.legalName ? `Found ${result.legalName}. Check the details, then save.` : "Details found. Check them, then save." });
    } catch {
      toast({ variant: "error", title: "Companies House couldn't be reached. Try again, or enter the details by hand." });
    } finally {
      setLooking(false);
    }
  }

  function onSave() {
    const website = /^https?:\/\//i.test(form.websiteUrl.trim()) ? form.websiteUrl.trim() : `https://${form.websiteUrl.trim()}`;
    void save(() =>
      saveVoiceSettingsAction({
        regulatory: {
          companyNumber: form.companyNumber,
          websiteUrl: website,
          registeredAddress: {
            line1: form.line1,
            line2: form.line2.trim() || null,
            city: form.city,
            region: form.region.trim() || null,
            postcode: form.postcode,
            country: "GB",
          },
          representative: { firstName: form.firstName, lastName: form.lastName, phone: form.phone, workEmail: form.workEmail },
        },
      }),
    );
  }

  return (
    <PanelCard
      title="Business details for your number"
      description="Twilio reviews these before issuing a UK business number. They are sent to Twilio only when you request the number."
      aside={
        view.canEdit ? (
          <Button size="sm" variant="secondary" loading={looking} onClick={lookup}>
            <Search className="size-3.5" aria-hidden />
            Look up on Companies House
          </Button>
        ) : undefined
      }
      footer={<SaveFooter canEdit={view.canEdit} saving={saving} onSave={onSave} disabled={incomplete} note={incomplete ? "Every field except address line 2 and county is needed." : null} />}
    >
      {found?.companiesHouse === "NOT_FOUND" && (
        <Notice role="status">Your business wasn&apos;t found on Companies House. Enter the details yourself.</Notice>
      )}
      {view.regulatory.ready ? (
        <Notice tone="success" role="status">These details are complete.</Notice>
      ) : problems.length > 0 && view.regulatory.details ? (
        <Notice tone="warning" role="status">Still needed: {problems.join(", ")}.</Notice>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={readOnly}>
        <legend className="sr-only">Company</legend>
        <FormField label="Companies House number" htmlFor="voice-crn" required hint="8 digits, or 2 letters and 6 digits.">
          <Input id="voice-crn" value={form.companyNumber} maxLength={10} onChange={set("companyNumber")} autoComplete="off" />
        </FormField>
        <FormField label="Website" htmlFor="voice-website" required>
          <Input id="voice-website" value={form.websiteUrl} maxLength={200} onChange={set("websiteUrl")} inputMode="url" placeholder="https://" />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={readOnly}>
        <legend className="mb-1 text-[13px] font-semibold text-content">Business address</legend>
        <FormField label="Address line 1" htmlFor="voice-line1" required className="sm:col-span-2">
          <Input id="voice-line1" value={form.line1} maxLength={120} onChange={set("line1")} autoComplete="address-line1" />
        </FormField>
        <FormField label="Address line 2" htmlFor="voice-line2" className="sm:col-span-2">
          <Input id="voice-line2" value={form.line2} maxLength={120} onChange={set("line2")} autoComplete="address-line2" />
        </FormField>
        <FormField label="Town or city" htmlFor="voice-city" required>
          <Input id="voice-city" value={form.city} maxLength={80} onChange={set("city")} autoComplete="address-level2" />
        </FormField>
        <FormField label="County" htmlFor="voice-region">
          <Input id="voice-region" value={form.region} maxLength={80} onChange={set("region")} autoComplete="address-level1" />
        </FormField>
        <FormField label="Postcode" htmlFor="voice-postcode" required>
          <Input id="voice-postcode" value={form.postcode} maxLength={12} onChange={set("postcode")} autoComplete="postal-code" />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={readOnly}>
        <legend className="mb-1 text-[13px] font-semibold text-content">Authorised representative</legend>
        <FormField label="First name" htmlFor="voice-rep-first" required>
          <Input id="voice-rep-first" value={form.firstName} maxLength={60} onChange={set("firstName")} autoComplete="given-name" />
        </FormField>
        <FormField label="Last name" htmlFor="voice-rep-last" required>
          <Input id="voice-rep-last" value={form.lastName} maxLength={60} onChange={set("lastName")} autoComplete="family-name" />
        </FormField>
        <FormField label="Phone" htmlFor="voice-rep-phone" required hint={readOnly && d.representative?.phone ? "Set. Only owners and admins can see it." : undefined}>
          <Input id="voice-rep-phone" value={form.phone} maxLength={30} onChange={set("phone")} inputMode="tel" autoComplete="tel" />
        </FormField>
        <FormField label="Work email" htmlFor="voice-rep-email" required hint={readOnly && d.representative?.workEmail ? "Set. Only owners and admins can see it." : undefined}>
          <Input id="voice-rep-email" value={form.workEmail} maxLength={200} onChange={set("workEmail")} inputMode="email" autoComplete="email" />
        </FormField>
      </fieldset>
    </PanelCard>
  );
}
