import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  AUTOMATION_TYPES,
  cadenceSummary,
  type AutomationDetail,
  type AutomationListItem,
  type AutomationStatus,
  type AutomationStep,
  type AutomationType,
  type AutomationVersionSummary,
  type Channel,
  type QuietHoursSettings,
} from "./types";

export * from "./types";

type VersionRow = {
  id: string;
  automation_id: string;
  version_number: number;
  status: string;
  published_at: string | null;
  updated_at: string;
};

type StepRow = {
  id: string;
  version_id: string;
  position: number;
  delay_seconds: number;
  channel: string;
  template: string;
  enabled: boolean;
};

function toStep(row: StepRow): AutomationStep {
  return {
    id: row.id,
    position: row.position,
    delaySeconds: row.delay_seconds,
    channel: row.channel as Channel,
    template: row.template,
    enabled: row.enabled,
  };
}

function statusFor(
  enabled: boolean,
  hasPublished: boolean,
): AutomationStatus {
  if (!hasPublished) return "draft";
  return enabled ? "active" : "paused";
}

/** Active run counts keyed by version id. */
async function activeRunCounts(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("automation_runs")
    .select("version_id")
    .eq("business_id", businessId)
    .eq("state", "ACTIVE")
    .limit(5000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.version_id, (counts.get(row.version_id) ?? 0) + 1);
  }
  return counts;
}

export async function listAutomations(
  businessId: string,
): Promise<AutomationListItem[]> {
  const supabase = await createClient();

  const [definitions, versions, runCounts] = await Promise.all([
    supabase
      .from("automation_definitions")
      .select("id, type, name, enabled, updated_at")
      .eq("business_id", businessId),
    supabase
      .from("automation_versions")
      .select("id, automation_id, version_number, status, published_at, updated_at")
      .eq("business_id", businessId),
    activeRunCounts(businessId),
  ]);

  const versionRows = (versions.data ?? []) as VersionRow[];
  const versionIds = versionRows.map((row) => row.id);

  let stepRows: StepRow[] = [];
  if (versionIds.length > 0) {
    const { data } = await supabase
      .from("automation_steps")
      .select("id, version_id, position, delay_seconds, channel, template, enabled")
      .eq("business_id", businessId)
      .in("version_id", versionIds)
      .order("position");
    stepRows = (data ?? []) as StepRow[];
  }

  return (definitions.data ?? []).map((definition) => {
    const mine = versionRows.filter(
      (row) => row.automation_id === definition.id,
    );
    const published = mine.find((row) => row.status === "PUBLISHED") ?? null;
    const draft = mine.find((row) => row.status === "DRAFT") ?? null;
    const shown = published ?? draft;
    const steps = stepRows
      .filter((row) => row.version_id === shown?.id)
      .map(toStep);

    const leadsInSequence = mine.reduce(
      (total, row) => total + (runCounts.get(row.id) ?? 0),
      0,
    );

    return {
      id: definition.id,
      type: definition.type as AutomationType,
      name: definition.name,
      enabled: definition.enabled,
      status: statusFor(definition.enabled, Boolean(published)),
      stepCount: steps.length,
      cadence: cadenceSummary(steps),
      channels: [...new Set(steps.map((step) => step.channel))],
      hasDraft: Boolean(draft),
      leadsInSequence,
      updatedAt: definition.updated_at,
    };
  });
}

export function missingAutomationTypes(
  existing: AutomationListItem[],
): AutomationType[] {
  const present = new Set(existing.map((item) => item.type));
  return AUTOMATION_TYPES.filter((type) => !present.has(type));
}

export async function getAutomation(
  businessId: string,
  automationId: string,
): Promise<AutomationDetail | null> {
  const supabase = await createClient();

  const { data: definition } = await supabase
    .from("automation_definitions")
    .select("id, type, name, enabled, updated_at")
    .eq("business_id", businessId)
    .eq("id", automationId)
    .maybeSingle();

  if (!definition) return null;

  const { data: versionData } = await supabase
    .from("automation_versions")
    .select("id, automation_id, version_number, status, published_at, updated_at")
    .eq("business_id", businessId)
    .eq("automation_id", automationId)
    .order("version_number", { ascending: false });

  const versionRows = (versionData ?? []) as VersionRow[];
  const versionIds = versionRows.map((row) => row.id);

  let stepRows: StepRow[] = [];
  if (versionIds.length > 0) {
    const { data } = await supabase
      .from("automation_steps")
      .select("id, version_id, position, delay_seconds, channel, template, enabled")
      .eq("business_id", businessId)
      .in("version_id", versionIds)
      .order("position");
    stepRows = (data ?? []) as StepRow[];
  }

  const runCounts = await activeRunCounts(businessId);

  const versions: AutomationVersionSummary[] = versionRows.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    status: row.status as AutomationVersionSummary["status"],
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    stepCount: stepRows.filter((step) => step.version_id === row.id).length,
    leadsInSequence: runCounts.get(row.id) ?? 0,
  }));

  const published = versionRows.find((row) => row.status === "PUBLISHED") ?? null;
  const draft = versionRows.find((row) => row.status === "DRAFT") ?? null;
  const editing = draft ?? published;

  const steps = stepRows
    .filter((row) => row.version_id === editing?.id)
    .map(toStep);

  const leadsInSequence = versions.reduce(
    (total, version) => total + version.leadsInSequence,
    0,
  );
  const leadsOnOlderVersions = versions
    .filter((version) => version.status !== "PUBLISHED")
    .reduce((total, version) => total + version.leadsInSequence, 0);

  return {
    id: definition.id,
    type: definition.type as AutomationType,
    name: definition.name,
    enabled: definition.enabled,
    status: statusFor(definition.enabled, Boolean(published)),
    versions,
    publishedVersionNumber: published?.version_number ?? null,
    editingVersionId: editing?.id ?? null,
    editingVersionNumber:
      editing?.version_number ??
      (versionRows[0]?.version_number ? versionRows[0].version_number + 1 : 1),
    editingIsDraft: Boolean(draft),
    steps,
    leadsInSequence,
    leadsOnOlderVersions,
    updatedAt: definition.updated_at,
  };
}

export async function getQuietHours(
  businessId: string,
  timezone: string,
): Promise<QuietHoursSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_settings")
    .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
    .eq("business_id", businessId)
    .maybeSingle();

  return {
    enabled: data?.quiet_hours_enabled ?? true,
    start: (data?.quiet_hours_start ?? "20:00").slice(0, 5),
    end: (data?.quiet_hours_end ?? "08:00").slice(0, 5),
    timezone,
  };
}
