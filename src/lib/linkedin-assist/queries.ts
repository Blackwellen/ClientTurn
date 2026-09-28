import "server-only";
import {
  channelMoves,
  localDate,
  paceToday,
  stopReasonFor,
  STOP_REASON_LABEL,
  usageFrom,
  type LinkedInAssistSettings,
  type LinkedInCandidate,
  type LinkedInTaskView,
  type PaceResult,
} from "./types";
import {
  db,
  draftBusiness,
  latestAgentDraft,
  loadLeads,
  loadProspects,
  loadSettings,
  snapshotFrom,
  CONTACT_COLUMNS,
  TASK_COLUMNS,
  type ContactRow,
  type TaskRow,
} from "./store";

export type LinkedInAssistBoard = {
  today: string;
  settings: LinkedInAssistSettings;
  configured: boolean;
  aiEnabled: boolean;
  /** A platform admin's hold on the workspace (0175): the list is paused, replies only. */
  workspaceHold: { reason: string; heldAt: string } | null;
  tasks: LinkedInTaskView[];
  pace: Omit<PaceResult<LinkedInTaskView>, "visible">;
  upcoming: number;
  activeContacts: number;
  candidates: LinkedInCandidate[];
  leadOptions: { id: string; name: string }[];
};

/**
 * One person's LinkedIn Assist list for today. Read-only: stop conditions and
 * pacing are applied to what is shown, never written during the render (a
 * stopped task is cancelled when somebody next acts on it).
 */
export async function getLinkedInAssistBoard(input: {
  businessId: string;
  userId: string;
  timezone: string;
}): Promise<LinkedInAssistBoard> {
  const now = new Date();
  const today = localDate(now, input.timezone || "Europe/London");
  const since = new Date(now.getTime() - 35 * 86_400_000).toISOString();

  const [{ settings, configured, personPaused, workspaceHold }, { aiEnabled }, openResult, sentResult, upcomingResult, activeResult] =
    await Promise.all([
      loadSettings(input.businessId, input.userId),
      draftBusiness(input.businessId),
      db()
        .from("linkedin_assist_tasks")
        .select(TASK_COLUMNS)
        .eq("business_id", input.businessId)
        .eq("assignee_user_id", input.userId)
        .eq("status", "OPEN")
        .lte("due_on", today)
        .order("due_on", { ascending: true })
        .limit(200),
      db()
        .from("linkedin_assist_tasks")
        .select("kind, completed_at, body")
        .eq("business_id", input.businessId)
        .eq("assignee_user_id", input.userId)
        .eq("status", "SENT")
        .gte("completed_at", since)
        .limit(2000),
      db()
        .from("linkedin_assist_tasks")
        .select("id", { count: "exact", head: true })
        .eq("business_id", input.businessId)
        .eq("assignee_user_id", input.userId)
        .eq("status", "OPEN")
        .gt("due_on", today),
      db()
        .from("linkedin_assist_contacts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", input.businessId)
        .eq("owner_user_id", input.userId)
        .in("state", ["NOT_STARTED", "INVITED", "MESSAGED", "REPLIED"]),
    ]);
  if (openResult.error) throw openResult.error;
  if (sentResult.error) throw sentResult.error;

  const open = (openResult.data ?? []) as TaskRow[];
  const contactIds = [...new Set(open.map((task) => task.contact_id))];
  const { data: contactRows, error: contactError } = contactIds.length
    ? await db().from("linkedin_assist_contacts").select(CONTACT_COLUMNS).eq("business_id", input.businessId).in("id", contactIds)
    : { data: [], error: null };
  if (contactError) throw contactError;
  const contacts = new Map((contactRows as ContactRow[]).map((row) => [row.id, row]));

  const leadIds = [...new Set([...contacts.values()].map((c) => c.lead_id).filter((id): id is string => Boolean(id)))];
  const prospectIds = [...new Set([...contacts.values()].map((c) => c.prospect_id).filter((id): id is string => Boolean(id)))];
  const [leads, prospects] = await Promise.all([
    loadLeads(input.businessId, leadIds),
    loadProspects(input.businessId, prospectIds),
  ]);

  const views: LinkedInTaskView[] = [];
  for (const task of open) {
    const contact = contacts.get(task.contact_id);
    if (!contact) continue;
    const subject = snapshotFrom(
      contact.lead_id ? leads.get(contact.lead_id) : undefined,
      contact.prospect_id ? prospects.get(contact.prospect_id) : undefined,
    );
    if (!subject) continue;
    const reason = stopReasonFor(task.kind, {
      contactState: contact.state,
      optedOut: subject.optedOut || contact.stopped_reason === "OPTED_OUT",
      leadStatus: subject.leadStatus,
    });

    let body = task.body;
    let drafting = false;
    if (task.kind === "REPLY" && !body) {
      const draft = contact.conversation_id
        ? await latestAgentDraft(input.businessId, contact.conversation_id, task.created_at)
        : null;
      body = draft?.body ?? null;
      drafting = !draft && task.body_source === "AGENT";
    }

    views.push({
      id: task.id,
      contactId: contact.id,
      kind: task.kind,
      step: task.step,
      dueOn: task.due_on,
      createdAt: task.created_at,
      body,
      bodySource: task.body_source,
      fallbackReason: task.fallback_reason,
      inboundBody: task.inbound_body,
      snoozeCount: task.snooze_count,
      profileUrl: contact.profile_url,
      name: subject.name,
      subtitle: subject.subtitle,
      leadId: contact.lead_id,
      prospectId: contact.prospect_id,
      contactState: contact.state,
      moves: channelMoves(subject.moveLead),
      blocked: reason
        ? reason === "REPLIED"
          ? "They replied, so this outreach step is no longer needed."
          : reason === "FINISHED"
            ? "This sequence has finished."
            : STOP_REASON_LABEL[reason]
        : null,
      drafting,
    });
  }

  const usage = usageFrom(
    ((sentResult.data ?? []) as { kind: TaskRow["kind"]; completed_at: string; body: string | null }[]).map((row) => ({
      kind: row.kind,
      completedAt: row.completed_at,
      withNote: Boolean(row.body),
    })),
    now,
    input.timezone || "Europe/London",
  );
  const actionable = views.filter((view) => !view.blocked);
  const { visible, ...pace } = paceToday(actionable, usage, settings);
  // Stopped tasks stay visible (with the reason) so the person sees why they
  // left the list; acting on one cancels it.
  const stopped = views.filter((view) => view.blocked);

  const [candidates, leadOptions] = await Promise.all([
    loadCandidates(input.businessId),
    loadLeadOptions(input.businessId),
  ]);

  return {
    today,
    // The person's own switch for the pacing form; the hold is shown apart,
    // so saving the form never turns a platform hold into a personal pause.
    settings: { ...settings, paused: personPaused },
    configured,
    aiEnabled: aiEnabled && !workspaceHold,
    workspaceHold,
    tasks: [...visible, ...stopped],
    pace,
    upcoming: upcomingResult.count ?? 0,
    activeContacts: activeResult.count ?? 0,
    candidates,
    leadOptions,
  };
}

/** Prospects with a LinkedIn profile who are not already on anybody's list. */
async function loadCandidates(businessId: string): Promise<LinkedInCandidate[]> {
  const { data: onList } = await db()
    .from("linkedin_assist_contacts")
    .select("prospect_id")
    .eq("business_id", businessId)
    .not("prospect_id", "is", null)
    .limit(2000);
  const taken = new Set((onList ?? []).map((row) => row.prospect_id as string));

  const { data } = await db()
    .from("prospects")
    .select("id, first_name, last_name, role_title, linkedin_url, prospect_companies ( name )")
    .eq("business_id", businessId)
    .not("linkedin_url", "is", null)
    .neq("outreach_eligibility", "SUPPRESSED")
    .neq("status", "SUPPRESSED")
    .order("created_at", { ascending: false })
    .limit(60);

  return ((data ?? []) as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    role_title: string | null;
    linkedin_url: string | null;
    prospect_companies: { name: string | null } | null;
  }[])
    .filter((row) => !taken.has(row.id))
    .slice(0, 20)
    .map((row) => ({
      kind: "prospect" as const,
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.prospect_companies?.name || "Prospect",
      subtitle: [row.role_title, row.prospect_companies?.name].filter(Boolean).join(" · ") || null,
      profileUrl: row.linkedin_url,
    }));
}

/** Recent open leads not yet on LinkedIn Assist, for "add by profile link". */
async function loadLeadOptions(businessId: string): Promise<{ id: string; name: string }[]> {
  const [{ data: onList }, { data: leads }] = await Promise.all([
    db()
      .from("linkedin_assist_contacts")
      .select("lead_id")
      .eq("business_id", businessId)
      .not("lead_id", "is", null)
      .limit(2000),
    db()
      .from("leads")
      .select("id, first_name, last_name, company_name, email")
      .eq("business_id", businessId)
      .eq("opted_out", false)
      .is("archived_at", null)
      .not("status", "in", "(WON,LOST)")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  const taken = new Set((onList ?? []).map((row) => row.lead_id as string));
  return ((leads ?? []) as { id: string; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }[])
    .filter((row) => !taken.has(row.id))
    .slice(0, 50)
    .map((row) => ({
      id: row.id,
      name:
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.company_name ||
        row.email ||
        "Lead",
    }));
}
