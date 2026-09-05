export type Attribution = {
  anonymousId: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  landingPath?: string;
};

const STORAGE_KEY = "lr.attribution";

const UTM_KEYS = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content: "utmContent",
  utm_term: "utmTerm",
} as const;

function newAnonymousId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function read(): Attribution | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Attribution;
    return parsed && typeof parsed.anonymousId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function write(value: Attribution) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — attribution is best-effort, never blocking */
  }
}

/**
 * First touch wins: once a session has UTM values we keep them, so a user who
 * wanders through the site before signing up is still credited to the campaign
 * that brought them in.
 */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") {
    return { anonymousId: "" };
  }

  const existing = read();
  const params = new URLSearchParams(window.location.search);

  const fromUrl: Partial<Attribution> = {};
  for (const param of Object.keys(UTM_KEYS) as (keyof typeof UTM_KEYS)[]) {
    const value = params.get(param)?.trim();
    if (value) fromUrl[UTM_KEYS[param]] = value.slice(0, 200);
  }

  const hasUrlUtms = Object.keys(fromUrl).length > 0;
  if (existing && !hasUrlUtms) return existing;
  if (existing && hasUrlUtms && existing.utmSource) return existing;

  const referrer =
    typeof document !== "undefined" && document.referrer
      ? document.referrer.slice(0, 500)
      : undefined;

  const next: Attribution = {
    anonymousId: existing?.anonymousId ?? newAnonymousId(),
    ...existing,
    ...fromUrl,
    referrer: existing?.referrer ?? referrer,
    landingPath:
      existing?.landingPath ??
      `${window.location.pathname}${window.location.search}`.slice(0, 500),
  };

  write(next);
  return next;
}

export function getAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  return read();
}

export function clearAttribution() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Field names the signup form renders as hidden inputs. */
export const ATTRIBUTION_FIELDS = [
  "anonymousId",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "referrer",
  "landingPath",
] as const satisfies readonly (keyof Attribution)[];
