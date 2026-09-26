import { ALL_RULES, retainedOnAnonymise, retainedOnDelete, ruleFor } from "./coverage.ts";

/**
 * What a person is told before and after a data-rights act (brief §15).
 *
 * Pure, so the one rule that matters most here can be tested: **never say
 * "deleted" when something remains.** A delete in this product always leaves
 * something -- a hashed suppression entry so the person is not contacted
 * again, billing and audit rows with ids that no longer resolve to anybody --
 * so the outcome of a delete is "erased", and the sentence always names what
 * was kept. Telling a customer (who may repeat it to the data subject) that
 * data was deleted when some of it was retained would be a false statement
 * about personal data, which is exactly what a regulator asks about.
 */

export type DataRightsMode = "SUPPRESS" | "RESTRICT" | "ANONYMISE" | "DELETE" | "EXPORT";

export type Confirmation = {
  title: string;
  /** What the action touches. */
  scope: string;
  /** What happens, including what remains. */
  consequence: string;
  confirmLabel: string;
  variant: "danger" | "warning" | "default";
};

/**
 * Confirmation copy. Written so the dialog body alone is enough to decide:
 * what goes, what stays, and whether it can be undone.
 */
export const CONFIRMATION: Record<DataRightsMode, Confirmation> = {
  SUPPRESS: {
    title: "Suppress this lead?",
    scope:
      "Every address held for this lead is added to the do-not-contact list on the channel you choose. Follow-up stops.",
    consequence:
      "The lead and its history are kept. Nothing is sent to these addresses again from this workspace, and the entry can only be lifted by ClientTurn support with a recorded reason.",
    confirmLabel: "Suppress",
    variant: "warning",
  },
  RESTRICT: {
    title: "Restrict processing for this lead?",
    scope:
      "Places a legal hold on every address held for this lead, across all channels. Follow-up and outreach stop.",
    consequence:
      "The lead's data is kept exactly as it is, but it is not used to contact the person. Use this when the person has asked for restriction (UK GDPR Art 18).",
    confirmLabel: "Restrict",
    variant: "warning",
  },
  ANONYMISE: {
    title: "Anonymise this lead?",
    scope:
      "Removes the name, email, phone, postcode, company and notes; replaces message text with [removed]; removes qualification answers, AI summaries and extracted facts; stops all follow-up.",
    consequence:
      "Kept: the lead's status and dates for reporting, attribution to its source, billing and audit entries, and any do-not-contact entry as a hash that no longer shows the address. This cannot be undone.",
    confirmLabel: "Anonymise",
    variant: "danger",
  },
  DELETE: {
    title: "Erase this lead?",
    scope:
      "Anonymises the lead, then removes the lead record, its conversations, bookings, scores, notes and permissions. Owners and admins only.",
    consequence:
      "Kept, with ids that no longer identify anyone: billing and usage records, the audit trail, AI cost records, compliance decisions, and any do-not-contact entry as a hash so the person is not contacted again. This cannot be undone.",
    confirmLabel: "Erase lead",
    variant: "danger",
  },
  EXPORT: {
    title: "Export everything held on this lead?",
    scope:
      "Downloads one JSON file with the lead's details, conversations, provenance, consent records, contactability decisions, scores with their explanations and do-not-contact status.",
    consequence:
      "The file contains personal data. Store and send it securely. The export is recorded against your name.",
    confirmLabel: "Export",
    variant: "default",
  },
};

/* ------------------------------------------------------------- outcomes */

/** `data_rights_scrub` counts: table -> verb -> rows. */
export type ScrubCounts = Record<string, Record<string, number>>;

export type Outcome = {
  headline: string;
  changed: string[];
  kept: string[];
};

const VERB: Record<string, string> = {
  redacted: "personal values removed",
  removed: "removed",
  hashed: "converted to a salted hash",
  merged_into_hash: "folded into an existing hashed entry",
  stopped: "stopped",
  cancelled: "cancelled",
  discarded_unsent: "unsent items discarded",
};

/** Table names that are not in the rule list but can appear in counts. */
const EXTRA_LABELS: Record<string, string> = {
  legacy_suppression_list: "entries on the retired suppression list",
};

function labelFor(table: string): string {
  return ruleFor(table)?.label ?? EXTRA_LABELS[table] ?? table.replace(/_/g, " ");
}

export function plural(n: number, word: string): string {
  const many = word.endsWith("y")
    ? `${word.slice(0, -1)}ies`
    : word.endsWith("s")
      ? `${word}es`
      : `${word}s`;
  return `${n.toLocaleString("en-GB")} ${n === 1 ? word : many}`;
}

/** One line per table the act changed, in rule order. */
export function describeChanges(counts: ScrubCounts): string[] {
  const order = new Map(ALL_RULES.map((rule, index) => [rule.table, index]));
  return Object.entries(counts)
    .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    .flatMap(([table, verbs]) =>
      Object.entries(verbs)
        .filter(([, rows]) => rows > 0)
        .map(([verb, rows]) => `${capitalise(labelFor(table))}: ${VERB[verb] ?? verb} (${plural(rows, "record")}).`),
    );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** What stays after an act, as sentences a person can read. */
export function describeKept(mode: "ANONYMISE" | "DELETE"): string[] {
  const tables = mode === "DELETE" ? retainedOnDelete() : retainedOnAnonymise();
  const lines = tables.map((table) => {
    const rule = ruleFor(table);
    return rule?.retainedBecause
      ? `${capitalise(rule.label)} — ${rule.retainedBecause}`
      : capitalise(labelFor(table));
  });
  if (mode === "ANONYMISE") {
    lines.unshift(
      "The lead record itself, with its status, dates, source and value, so reporting and attribution still add up.",
    );
  }
  return lines;
}

export function describeOutcome(
  mode: "ANONYMISE" | "DELETE",
  counts: ScrubCounts,
): Outcome {
  const kept = describeKept(mode);
  const changed = describeChanges(counts);
  const headline =
    mode === "DELETE"
      ? "Lead erased. The lead record and its history were removed; the records listed below were kept without anything that identifies the person."
      : "Lead anonymised. Personal details were removed; the lead stays in your reporting without them.";
  return { headline, changed, kept };
}

/**
 * The wording rule, as a predicate the tests and the UI can share: a claim of
 * deletion is only true when nothing about the person was kept.
 */
export function claimsDeletion(text: string): boolean {
  return /\bdelet(ed|ion)\b/i.test(text) || /\ball (of )?(their|the|your) data\b/i.test(text);
}

export function suppressionOutcome(result: {
  mode: "SUPPRESS" | "RESTRICT";
  channel: string;
  entriesAdded: number;
  destinations: { email: number; phone: number; social: number };
}): string {
  const held = result.destinations.email + result.destinations.phone + result.destinations.social;
  if (held === 0) {
    return "This lead has no email, phone or social address on record, so there was nothing to add to the do-not-contact list. Follow-up was stopped.";
  }
  const channel = result.channel === "ALL" ? "every channel" : result.channel.toLowerCase();
  const verb = result.mode === "RESTRICT" ? "placed on legal hold" : "suppressed";
  const added =
    result.entriesAdded === 0
      ? "They were already on the list."
      : `${plural(result.entriesAdded, "entry")} added.`;
  return `${plural(held, "address")} ${verb} on ${channel}. ${added} The lead and its history are kept.`;
}
