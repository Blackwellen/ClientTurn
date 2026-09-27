/**
 * What a company's own pages announce about itself: funding rounds, senior
 * hires, new offices, launches, awards, tenders, the roles on its careers
 * page, and problems anyone can see in its markup.
 *
 * Pure -- no `server-only`, no fetch -- so every phrase family is tested with
 * positive and negative controls (`tests/intent-extractors.test.ts`). The
 * adapter in `server/providers/website-intent.ts` fetches the pages.
 *
 * ## How a phrase earns a match
 *
 * Marketing copy is full of the same words as news. An agency's services page
 * says "we help founders prepare for their Series A" and "launch your product
 * faster"; neither is an event at that company. So every family needs:
 *
 *   * an announcement shape (a past or present-tense verb about the company
 *     itself, in the same sentence), and
 *   * no service-copy shape in the same sentence ("we help", "help you",
 *     "your business", "how to").
 *
 * ## Personal data
 *
 * An appointment post names the person. The snippet for a senior hire is
 * rebuilt from the verb and the role only ("Welcomes … as Chief Technology
 * Officer"), so a name never reaches storage; the page URL is the reference
 * anyone can open to read the rest.
 */

import type { IntentTypeId, RoleFunction } from "./intent-catalogue.ts";
import { truncateSnippet } from "./intent-evidence.ts";

export type Announcement = {
  type: IntentTypeId;
  snippet: string;
  /** Where in the text it matched, for ordering. */
  index: number;
  roleFunction?: RoleFunction | null;
  /** "Series A", "Seed", ... when a round is named. */
  round?: string | null;
  /** "£2.5m", as written. */
  amount?: string | null;
};

/* ------------------------------------------------------------ sentences */

/** The sentence containing `index`, bounded so a page with no full stops stays small. */
export function sentenceAt(text: string, index: number, length = 0): { sentence: string; start: number } {
  const before = text.slice(Math.max(0, index - 220), index);
  const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "), before.lastIndexOf("\n"));
  const start = cut >= 0 ? index - before.length + cut + 2 : Math.max(0, index - 220);
  const afterText = text.slice(index + length, index + length + 220);
  const endMatch = afterText.search(/[.!?](\s|$)|\n/);
  const end = endMatch >= 0 ? index + length + endMatch + 1 : Math.min(text.length, index + length + 220);
  return { sentence: text.slice(start, end), start };
}

/** Service copy: the company describing what it does for others, not news about itself. */
const SERVICE_COPY =
  /\b(we help|helping (you|businesses|brands|companies|founders|start-?ups|clients|organisations)|help(s)? (you|your|clients|businesses|brands|companies|founders)|your (business|brand|company|product|website|site|team|start-?up|round|organisation)|for (our )?clients|how to|guide to|tips (for|on)|case study|we specialise|our services|bid writing|tender writing)\b/i;

export function isServiceCopy(sentence: string): boolean {
  return SERVICE_COPY.test(sentence);
}

function snip(sentence: string): string {
  return truncateSnippet(sentence.trim());
}

/* ------------------------------------------------------- role functions */

const FUNCTION_WORDS: [RoleFunction, RegExp][] = [
  ["MARKETING", /\b(marketing|growth|brand|content|demand gen\w*|communications|seo|ppc|social media|copywriter|marketer)\b/i],
  ["SALES", /\b(sales|revenue|commercial|business development|account executive|sdr|bdr|partnerships)\b/i],
  ["DATA", /\b(data|analytics|insights?|business intelligence)\b/i],
  ["DESIGN", /\b(design(er)?|creative|ux|ui)\b/i],
  ["PRODUCT", /\b(product)\b/i],
  ["FINANCE", /\b(finance|financial|accountant|bookkeeper|payroll|fp&a|controller|cfo)\b/i],
  ["PEOPLE", /\b(people|hr|human resources|talent|recruit\w*)\b/i],
  ["CUSTOMER_SUCCESS", /\b(customer|client success|client services|support)\b/i],
  ["LEGAL", /\b(legal|counsel|compliance|solicitor|paralegal)\b/i],
  ["IT_SECURITY", /\b(security|information|it|infrastructure|network|ciso|cio|service desk|systems administrator)\b/i],
  ["ENGINEERING", /\b(technology|technical|engineering|engineer|developer|development|software|devops|cto)\b/i],
  ["OPERATIONS", /\b(operations|operating|coo|office manager|project manager|programme manager)\b/i],
];

/** The business function a job title belongs to, or null (a CEO runs everything). */
export function roleFunctionForTitle(title: string): RoleFunction | null {
  if (/\b(ceo|chief executive|managing director|founder|chair\w*)\b/i.test(title)) return null;
  for (const [fn, pattern] of FUNCTION_WORDS) if (pattern.test(title)) return fn;
  return null;
}

/** C-level, VP or Head-of, from a title. Null for anything else. */
export function seniorityForTitle(title: string): "C_LEVEL" | "VP" | "HEAD" | null {
  if (/\b(chief [a-z]+(?: [a-z]+)? officer|ceo|cto|cfo|cmo|coo|cro|cpo|ciso|cio|managing director)\b/i.test(title)) return "C_LEVEL";
  if (/\b(vp|vice[- ]president)\b/i.test(title)) return "VP";
  if (/\b(head of|director of)\b/i.test(title)) return "HEAD";
  return null;
}

/* ----------------------------------------------------------- phrase kit */

const AMOUNT = /(?:£|\$|€)\s?\d[\d.,]*\s?(?:m|mn|million|k|bn|billion)?\b/i;
const RAISE_VERB =
  /\b(raised|raises|raising|closed|closes|secured|secures|completed|completes|announce[sd]?|lands|landed|bags|bagged|led by)\b/i;
const ROUND_WORD = /\b(round|funding|investment|financing|raise)\b/i;
const ROUND = /\b(pre[- ]?seed|seed|series\s+([a-h]))\b/gi;
const NOT_FUNDRAISING = /\b(charity|charities|donat\w*|fundrais\w*|sponsor\w*|for (a|the) good cause)\b/i;

function roundType(round: string): { type: IntentTypeId; label: string } {
  const value = round.toLowerCase().replace(/\s+/g, " ");
  if (value.includes("seed")) return { type: "SEED_ROUND", label: value.startsWith("pre") ? "Pre-seed" : "Seed" };
  const letter = value.slice(-1).toUpperCase();
  if (letter === "A") return { type: "SERIES_A", label: "Series A" };
  if (letter === "B") return { type: "SERIES_B", label: "Series B" };
  return { type: "SERIES_C_PLUS", label: `Series ${letter}` };
}

type Family = {
  type: IntentTypeId;
  pattern: RegExp;
  /** Extra requirement on the sentence, beyond not being service copy. */
  sentence?: (sentence: string, match: RegExpExecArray, around: string) => boolean;
  /** Service copy is allowed to match (rare: phrases that are never copy). */
  allowServiceCopy?: boolean;
};

const TITLE =
  "(chief [a-z]+(?: [a-z]+)? officer|ceo|cto|cfo|cmo|coo|cro|cpo|ciso|cio|managing director|(?:vp|vice[- ]president)(?: of)? [a-z&]+(?: [a-z&]+)?|head of [a-z&]+(?: [a-z&]+)?)";
const TITLE_STOP = new Set(["at", "to", "for", "in", "on", "who", "with", "from", "the", "and", "as", "our", "this", "will", "has", "is", "joins", "after"]);

function tidyTitle(raw: string): string {
  const words = raw.trim().split(/\s+/);
  while (words.length > 2 && TITLE_STOP.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ");
}

const TECH_NAMES =
  "shopify|woocommerce|wordpress|webflow|squarespace|wix|magento|adobe commerce|bigcommerce|hubspot|salesforce|pardot|intercom|drift|zendesk|freshdesk|stripe|klaviyo|mailchimp|xero|quickbooks|sage|netsuite|sap|microsoft dynamics|dynamics 365|zoho|pipedrive|monday\\.com|asana|jira|notion|slack|microsoft teams|google workspace|microsoft 365|aws|amazon web services|azure|google cloud|snowflake|contentful|sanity|drupal|umbraco|sitecore|workday|bamboohr|hibob|gusto";

const REGIONS =
  "us|usa|u\\.s\\.|united states|north america|canada|europe|eu|germany|france|ireland|the netherlands|netherlands|spain|italy|nordics|scandinavia|apac|asia|australia|new zealand|middle east|uae|dubai|singapore|india|latam|scotland|wales|northern ireland";

const FAMILIES: Family[] = [
  /* funding: rounds are handled separately (they carry a round and amount) */
  {
    type: "CAPITAL_RAISED",
    pattern: /\b(raised|raises|secured|secures|closed|closes)\s+(?:a\s+|an\s+|over\s+|more than\s+|almost\s+)?(?:£|\$|€)\s?\d[\d.,]*\s?(?:m|mn|million|k|bn|billion)?\b/gi,
    sentence: (s) =>
      !NOT_FUNDRAISING.test(s) &&
      /\b(funding|investment|investors?|round|capital|equity|backed|led by|to accelerate|to fuel|to expand)\b/i.test(s) &&
      !/\b(pre[- ]?seed|seed|series\s+[a-h])\b/i.test(s),
  },
  {
    type: "GRANT_AWARDED",
    pattern: /\b(awarded|secured|won|wins|received|receives|granted)\b[^.]{0,80}?\b(grant|smart award|innovate uk (?:funding|award))\b/gi,
    sentence: (s) => !/\b(apply for|grant access|grant permission|grants? you)\b/i.test(s),
  },
  {
    type: "DEBT_FINANCE",
    pattern: /\b(debt facility|credit facility|loan facility|venture debt|revenue[- ]based financ\w+|debt financ\w+|growth loan)\b/gi,
    sentence: (s) => /\b(secured|secures|closed|closes|agreed|announce[sd]?|signed|completed|arranged|obtained|received)\b/i.test(s),
  },
  {
    type: "IPO_LISTING",
    pattern: /\b(admission to (?:trading on )?(?:aim|the main market|the london stock exchange)|admitted to (?:trading on )?(?:aim|the main market)|initial public offering|ipo|listed on (?:the )?(?:london stock exchange|aim|nasdaq|nyse)|intention to float|first day of (?:dealings|trading))\b/gi,
    sentence: (s) =>
      /\b(we|our|today|announce[sd]?|completed|pleased|delighted|successful|confirms?)\b/i.test(s) &&
      !/\b(readiness|advis\w+|prepare|preparing)\b/i.test(s),
  },
  {
    type: "ACQUISITION_MERGER",
    pattern: /\b((?:has|have)\s+(?:been\s+)?acquired|acquired by|(?:announce[sd]?|completed?|completes|agreed)\s+(?:the\s+|its\s+|our\s+)?(?:acquisition|merger)|merged with|agreed to (?:acquire|merge)|is now part of)\b/gi,
  },
  {
    type: "NEW_INVESTOR",
    pattern: /\b((?:round|investment|raise)\s+(?:was\s+)?led by|with participation from|welcomes?\s+(?:new\s+)?(?:investment|investors?|backing)\s+from|new investors? (?:include|including))\b/gi,
    sentence: (s) => !NOT_FUNDRAISING.test(s),
  },

  /* people (senior hires handled separately: they carry a title) */
  {
    type: "KEY_DEPARTURE",
    pattern: /\b(steps? down|stepped down|stepping down|has left|will leave|leaves|departs?|departure of|retires?|retiring|retirement of)\b/gi,
    sentence: (s) =>
      new RegExp(`\\b(${TITLE}|founder|co-founder|chair(?:man|woman|person)?|director)\\b`, "i").test(s),
  },
  {
    type: "TEAM_GROWTH",
    pattern: /\b(welcom(?:e|es|ed|ing)\s+(?:our\s+)?(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|a host of)?\s*new\s+(?:starters|joiners|team members|hires|faces|colleagues|recruits)|meet (?:our|the) new (?:starters|joiners|team members|hires|recruits))\b/gi,
  },

  /* growth */
  {
    type: "HEADCOUNT_GROWTH",
    pattern: /\b((?:grown|grew|growing)\s+(?:our team\s+|the team\s+)?(?:to|past|beyond)\s+(?:over\s+|more than\s+)?\d[\d,]*\s+(?:people|employees|staff|colleagues|team members)|(?:doubled|tripled|trebled)\s+(?:the size of\s+)?(?:our|the|in)?\s*(?:team|headcount|size|workforce)|headcount\s+(?:has\s+)?(?:grown|doubled|increased|risen)|now\s+\d[\d,]*\s+(?:people|employees|staff)\s+strong)\b/gi,
  },
  {
    type: "NEW_OFFICE",
    pattern: /\b((?:open(?:ed|s|ing)?|launch(?:ed|es|ing)?|unveil(?:ed|s)?)\s+(?:a\s+|an\s+|our\s+|its\s+|the\s+)?(?:brand[- ]new\s+|new\s+|second\s+|third\s+|fourth\s+|fifth\s+|flagship\s+)?(?:[A-Za-z]+\s+)?(?:office|offices|studio|hub|headquarters|hq|premises)|(?:moved|moving|relocated|relocating)\s+(?:in)?to\s+(?:a\s+|our\s+|new\s+|bigger\s+|larger\s+)*(?:office|offices|premises|headquarters|hq|studio)|new (?:office|studio|hq|headquarters) in)\b/gi,
    sentence: (s, m) => {
      const text = m[0];
      if (/\bopen[- ]plan\b/i.test(text)) return false;
      // "Opened our office" alone is a daily event; a new or named site is news.
      if (/^(open|launch|unveil)/i.test(text)) {
        return /\b(new|second|third|fourth|fifth|flagship)\b/i.test(text) || /\s[A-Z][a-z]+\s+(office|offices|studio|hub|headquarters|hq|premises)$/.test(text);
      }
      return !/\b(hours|times)\b/i.test(s.slice(s.indexOf(text) + text.length, s.indexOf(text) + text.length + 12));
    },
  },
  {
    type: "REGION_EXPANSION",
    pattern: new RegExp(
      `\\b(expan(?:d|ds|ded|ding|sion)\\s+(?:our\\s+\\w+\\s+)?(?:in)?to\\s+(?:the\\s+)?(?:${REGIONS})|launch(?:ed|es|ing)?\\s+in\\s+(?:the\\s+)?(?:${REGIONS})|international expansion)\\b`,
      "gi",
    ),
  },
  {
    type: "PRODUCT_LAUNCH",
    pattern: /\b((?:proud|excited|delighted|thrilled|pleased)\s+to\s+(?:launch|introduce|unveil|announce the (?:launch|release))|(?:launch(?:es|ed)|unveil(?:s|ed)|releases|released)\s+(?:its\s+|our\s+|a\s+|the\s+)?(?:new|brand[- ]new|latest)\s+\w+|now generally available|general availability of)\b/gi,
    sentence: (s) => !/\b(website|site)\b/i.test(s) || /\b(product|platform|app|feature|service)\b/i.test(s),
  },
  {
    type: "REBRAND",
    pattern: /\b((?:we(?:'ve| have)?|has|have)\s+(?:rebranded|changed (?:our|its) name)|our new (?:brand|name|look|identity|brand identity)|new brand identity|formerly known as|(?:is|are) now (?:called|known as)|unveil(?:s|ed)? (?:a |its |our )?(?:new )?(?:brand|rebrand)|(?:complete[sd]?|announce[sd]?|launch(?:es|ed)?)\s+(?:a |its |our )?rebrand)\b/gi,
  },
  {
    type: "WEBSITE_RELAUNCH",
    pattern: /\b(welcome to (?:our|the) (?:new|brand[- ]new|refreshed|redesigned|new-look)\s+(?:website|site)|(?:launched|relaunched|unveiled|went live with)\s+(?:our|a|its)\s+(?:new|brand[- ]new|redesigned|refreshed)\s+(?:website|site)|(?:our|the) new (?:website|site) is (?:now )?live|website relaunch)\b/gi,
  },
  {
    type: "AWARD_ACCREDITATION",
    pattern: /\b((?:won|wins|winners? of|scooped|picked up|took home)\b[^.]{0,80}?\bawards?|shortlisted (?:for|in)|finalists? (?:in|for|at)|(?:achieved|awarded|gained|earned|secured|obtained|received)\s+(?:the\s+|our\s+)?(?:iso\s?\d{4,5}(?::\d{4})?|cyber essentials(?: plus)?|b\s?corp(?: certification)?|investors in people)|(?:certified|accredited)\s+b\s?corp|now\s+(?:iso\s?\d{4,5}|b\s?corp|cyber essentials(?: plus)?)\s+certified)\b/gi,
  },
  {
    type: "NEW_PARTNERSHIP",
    pattern: /\b((?:partners|partnered|teamed up|teams up)\s+with|(?:announce[sd]?|forms?|formed|signs?|signed|launch(?:es|ed)?|enter(?:s|ed)? into)\s+(?:a\s+|an\s+|new\s+|strategic\s+|exclusive\s+)*partnership|strategic partnership with|(?:became|becomes|is now|are now|now an?)\s+(?:an?\s+)?(?:official|certified|accredited|premier|gold|platinum|elite)\s+[\w-]+\s+partner)\b/gi,
    sentence: (s, m) => {
      const after = s.slice(s.indexOf(m[0]) + m[0].length).trim().toLowerCase();
      return !/^(us|you|clients|customers|businesses|brands|organisations|companies)\b/.test(after);
    },
  },

  /* technology */
  {
    type: "TECH_REPLACED",
    pattern: new RegExp(
      `\\b((?:migrat(?:ed|ing|ion)|mov(?:ed|ing)|switch(?:ed|ing)|transition(?:ed|ing)|replatform(?:ed|ing))\\s+(?:away\\s+)?(?:from|off)\\s+(?:${TECH_NAMES})|replac(?:ed|ing)\\s+(?:${TECH_NAMES})\\s+with)\\b`,
      "gi",
    ),
  },
  {
    type: "TECH_ADOPTED",
    pattern: new RegExp(
      `\\b((?:moved|migrated|switched|upgraded|transitioned)\\s+(?:over\\s+)?to\\s+(?:${TECH_NAMES})|(?:now|recently)\\s+(?:running|built|powered|live)\\s+on\\s+(?:${TECH_NAMES})|(?:implemented|rolled out|adopted|deployed|went live (?:on|with))\\s+(?:${TECH_NAMES}))\\b`,
      "gi",
    ),
    sentence: (s) => !new RegExp(`\\b(from|off)\\s+(${TECH_NAMES})\\b`, "i").test(s),
  },
  {
    type: "PLATFORM_OUTGROWN",
    pattern: new RegExp(
      `\\b(outgr(?:own|ew)\\s+(?:our\\s+|its\\s+|the\\s+)(?:${TECH_NAMES}|platform|system|website|site|crm|stack|tools?)|re-?platform(?:ing)?|platform migration)\\b`,
      "gi",
    ),
  },

  /* events */
  {
    type: "TENDER_PUBLISHED",
    pattern: /\b(invitation to tender|request for (?:proposals?|quotations?|tenders?)|rfp|rfq|tender (?:opportunity|notice)|(?:we are|we're)\s+(?:inviting|seeking|requesting)\s+(?:proposals|quotes|quotations|tenders|bids))\b/gi,
    // A notice often puts the deadline in the next sentence, so the text
    // around the match is read, not only its sentence.
    sentence: (_s, m, around) => {
      return /\b(deadline|submission|submit|closing date|responses?|by \d|issued|invit\w+|seeking|tender documents|pack|proposals? (?:are|is) due)\b/i.test(around.replace(m[0], ""));
    },
  },
];

/* ---------------------------------------------------------- announcements */

function roundAnnouncements(text: string): Announcement[] {
  const found: Announcement[] = [];
  for (const match of text.matchAll(ROUND)) {
    const index = match.index ?? 0;
    const { sentence } = sentenceAt(text, index, match[0].length);
    if (isServiceCopy(sentence) || NOT_FUNDRAISING.test(sentence)) continue;
    // "Seed" is an ordinary word; a round needs round language right after it
    // or a raise verb in the sentence, and an announcement verb either way.
    const after = text.slice(index + match[0].length, index + match[0].length + 30);
    if (!ROUND_WORD.test(after) && !/\bin (?:a|its|our|the)\b/i.test(text.slice(Math.max(0, index - 12), index))) continue;
    if (!RAISE_VERB.test(sentence)) continue;
    const { type, label } = roundType(match[0]);
    const amount = sentence.match(AMOUNT)?.[0]?.replace(/\s+/g, "") ?? null;
    found.push({ type, index, round: label, amount, snippet: snip(sentence) });
  }
  return found;
}

function seniorHires(text: string): Announcement[] {
  const found: Announcement[] = [];
  const pattern = new RegExp(`\\b${TITLE}`, "gi");
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const { sentence, start } = sentenceAt(text, index, match[0].length);
    const lead = sentence.slice(0, index - start);
    const verb = lead.match(
      /\b(welcomes?|welcomed|welcoming|appoints?|appointed|appointment of|hires|hired|names|named|promotes?|promoted|joins?|joined|has joined|have joined)\b(?![\s\S]*\b(welcomes?|appoint\w*|hires|hired|names|named|promot\w*|join\w*)\b)/i,
    );
    if (!verb) continue;
    if (/\b(hiring|vacanc\w+|apply|looking for|recruiting|we're seeking|role of)\b/i.test(sentence)) continue;
    if (/\b(step\w* down|leav\w+|left|depart\w*|retir\w+)\b/i.test(sentence)) continue;
    if (isServiceCopy(sentence)) continue;
    const title = tidyTitle(match[0]);
    const seniority = seniorityForTitle(title);
    if (!seniority) continue;
    const type: IntentTypeId =
      seniority === "C_LEVEL" ? "SENIOR_HIRE_C_LEVEL" : seniority === "VP" ? "SENIOR_HIRE_VP" : "SENIOR_HIRE_HEAD_OF";
    const verbWord = verb[1].charAt(0).toUpperCase() + verb[1].slice(1).toLowerCase();
    found.push({
      type,
      index,
      roleFunction: roleFunctionForTitle(title),
      // Rebuilt from the verb and the role, so the person's name is not kept.
      snippet: `${verbWord} … as ${title.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Of|And)\b/g, (w) => w.toLowerCase())}`,
    });
  }
  return found;
}

/**
 * Every announcement on one page of text, at most one per type (the first),
 * except senior hires, which are kept per role function.
 */
export function detectAnnouncements(text: string): Announcement[] {
  const found: Announcement[] = [...roundAnnouncements(text), ...seniorHires(text)];

  for (const family of FAMILIES) {
    family.pattern.lastIndex = 0;
    for (const match of text.matchAll(family.pattern)) {
      const index = match.index ?? 0;
      const { sentence } = sentenceAt(text, index, match[0].length);
      if (!family.allowServiceCopy && isServiceCopy(sentence)) continue;
      const around = text.slice(Math.max(0, index - 200), index + match[0].length + 200);
      if (family.sentence && !family.sentence(sentence, match as RegExpExecArray, around)) continue;
      const amount = family.type === "CAPITAL_RAISED" ? (match[0].match(AMOUNT)?.[0]?.replace(/\s+/g, "") ?? null) : undefined;
      found.push({ type: family.type, index, snippet: snip(sentence), ...(amount !== undefined ? { amount } : {}) });
      break;
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((entry) => {
      const key = `${entry.type}:${entry.roleFunction ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* --------------------------------------------------------------- careers */

const HIRING_PAGE =
  /\b(we['’]?re hiring|we are hiring|join (our|the) team|open (roles|positions|vacancies)|current (vacancies|openings)|careers|apply now|job description|vacancies)\b/i;

export function isHiringPage(text: string): boolean {
  return HIRING_PAGE.test(text);
}

const LEVEL = "(?:(?:senior|snr|junior|jnr|lead|principal|graduate|trainee|mid-level|mid)\\s+)?";

/** Job titles by function. Ordered: the first function to claim a title wins. */
const ROLE_TITLES: [RoleFunction, RegExp][] = [
  ["DATA", new RegExp(`\\b${LEVEL}(data (?:analyst|scientist|engineer)|analytics (?:engineer|manager)|bi (?:analyst|developer)|business intelligence (?:analyst|developer))\\b`, "gi")],
  ["MARKETING", new RegExp(`\\b${LEVEL}(?:digital\\s+)?(marketing (?:manager|executive|lead|director|assistant|coordinator|specialist|officer|apprentice)|head of (?:marketing|growth|brand|content)|content (?:writer|marketer|manager|lead|strategist)|copywriter|seo (?:specialist|executive|manager|lead)|ppc (?:executive|specialist|manager)|paid (?:social|media|search) (?:executive|specialist|manager)|social media (?:manager|executive|coordinator)|growth (?:marketer|manager|lead)|brand manager|demand generation (?:manager|lead)|product marketing manager|performance marketing (?:manager|executive))\\b`, "gi")],
  ["SALES", new RegExp(`\\b${LEVEL}(account executive|business development (?:manager|executive|representative)|sales (?:manager|executive|director|representative|lead|development representative)|sdr|bdr|account manager|head of sales|partnerships manager)\\b`, "gi")],
  ["DESIGN", new RegExp(`\\b${LEVEL}((?:ui|ux|ui/ux|product|graphic|visual|web|motion|brand) designer|designer|design lead|head of design|creative director|art director)\\b`, "gi")],
  ["PRODUCT", new RegExp(`\\b${LEVEL}(product (?:manager|owner|lead)|head of product)\\b`, "gi")],
  ["ENGINEERING", new RegExp(`\\b${LEVEL}((?:software|frontend|front-end|backend|back-end|full[- ]stack|web|mobile|ios|android|devops|platform|site reliability|qa|test|php|react|\\.net|python|java) (?:engineer|developer)|developer|software engineer|engineering manager|head of engineering|tech lead|founding engineer)\\b`, "gi")],
  ["FINANCE", new RegExp(`\\b${LEVEL}(accountant|bookkeeper|finance (?:manager|director|assistant|business partner)|financial controller|credit controller|payroll (?:officer|administrator|manager)|head of finance)\\b`, "gi")],
  ["PEOPLE", new RegExp(`\\b${LEVEL}(hr (?:manager|advisor|adviser|business partner|generalist|coordinator|assistant)|people (?:partner|manager)|talent (?:acquisition (?:partner|manager|specialist)|partner|manager)|in-house recruiter|head of people)\\b`, "gi")],
  ["OPERATIONS", new RegExp(`\\b${LEVEL}(operations (?:manager|director|coordinator|executive|assistant)|office manager|project manager|programme manager|head of operations)\\b`, "gi")],
  ["CUSTOMER_SUCCESS", new RegExp(`\\b${LEVEL}(customer success (?:manager|executive|lead)|customer support (?:executive|specialist|agent|advisor)|support (?:engineer|specialist|agent)|customer service (?:advisor|executive|representative)|client services (?:manager|executive))\\b`, "gi")],
  ["LEGAL", new RegExp(`\\b${LEVEL}(solicitor|paralegal|legal counsel|in-house counsel|general counsel|compliance (?:officer|manager|analyst)|legal (?:assistant|manager))\\b`, "gi")],
  ["IT_SECURITY", new RegExp(`\\b${LEVEL}(it (?:support|manager|technician|administrator|engineer)(?: engineer| analyst)?|systems administrator|security (?:engineer|analyst)|infrastructure engineer|network engineer|service desk (?:analyst|engineer)|head of it)\\b`, "gi")],
];

/** Distinct open roles at or above this count read as a hiring spike. */
export const HIRING_SPIKE_MIN_ROLES = 6;

export type CareersFinding = {
  roles: { roleFunction: RoleFunction; titles: string[]; snippet: string }[];
  distinctTitles: number;
  spike: boolean;
  firstHires: { roleFunction: RoleFunction; snippet: string }[];
};

const FIRST_HIRE_FUNCTION: Record<string, RoleFunction> = {
  marketing: "MARKETING", marketer: "MARKETING", growth: "MARKETING", content: "MARKETING",
  sales: "SALES", salesperson: "SALES",
  engineering: "ENGINEERING", engineer: "ENGINEERING", developer: "ENGINEERING",
  design: "DESIGN", designer: "DESIGN",
  product: "PRODUCT", data: "DATA", finance: "FINANCE",
  hr: "PEOPLE", people: "PEOPLE", operations: "OPERATIONS",
  "customer success": "CUSTOMER_SUCCESS", legal: "LEGAL", it: "IT_SECURITY", security: "IT_SECURITY",
};

/**
 * Roles on a careers page, grouped by function, plus a volume spike and any
 * "first hire in the function" wording. Nothing on a page that does not read
 * as a hiring page (an About page naming "our Head of Marketing, Sam").
 */
export function careersFindings(text: string): CareersFinding {
  const empty: CareersFinding = { roles: [], distinctTitles: 0, spike: false, firstHires: [] };
  if (!isHiringPage(text)) return empty;

  const claimed = new Set<number>();
  const byFunction = new Map<RoleFunction, { titles: Set<string>; snippet: string }>();
  for (const [fn, pattern] of ROLE_TITLES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (claimed.has(index)) continue;
      // A longer title claimed by an earlier function ("data engineer") wins.
      let overlaps = false;
      for (const at of claimed) if (Math.abs(at - index) < 4) overlaps = true;
      if (overlaps) continue;
      claimed.add(index);
      const entry = byFunction.get(fn) ?? { titles: new Set<string>(), snippet: snip(sentenceAt(text, index, match[0].length).sentence) };
      entry.titles.add(match[0].toLowerCase().replace(/\s+/g, " "));
      byFunction.set(fn, entry);
    }
  }

  const roles = [...byFunction.entries()].map(([roleFunction, entry]) => ({
    roleFunction,
    titles: [...entry.titles],
    snippet: entry.snippet,
  }));
  const distinctTitles = roles.reduce((sum, role) => sum + role.titles.length, 0);

  const firstHires: CareersFinding["firstHires"] = [];
  const first =
    /\b(?:our\s+)?(?:first|founding)\s+(?:dedicated\s+|in-house\s+|full-time\s+)?(marketing|marketer|growth|content|sales|salesperson|engineering|engineer|developer|design|designer|product|data|finance|hr|people|operations|customer success|legal|it|security)\b(?:\s+(?:hire|role|person|team member|engineer|developer|designer|marketer|manager))?|\bbuild (?:out )?(?:our|the) (marketing|sales|engineering|design|product|data|finance|hr|people|operations|legal|it) (?:function|team|department) from (?:scratch|the ground up)\b/gi;
  const seen = new Set<RoleFunction>();
  for (const match of text.matchAll(first)) {
    const word = (match[1] ?? match[2] ?? "").toLowerCase();
    const fn = FIRST_HIRE_FUNCTION[word];
    if (!fn || seen.has(fn)) continue;
    // "Our first marketing campaign" is not a hire.
    const tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 12).toLowerCase();
    if (!match[2] && !/(hire|role|person|member|engineer|developer|designer|marketer|manager)$/.test(match[0].toLowerCase()) && !/^\s*(hire|role)/.test(tail)) continue;
    seen.add(fn);
    firstHires.push({ roleFunction: fn, snippet: snip(sentenceAt(text, match.index ?? 0, match[0].length).sentence) });
  }

  return { roles, distinctTitles, spike: distinctTitles >= HIRING_SPIKE_MIN_ROLES, firstHires };
}

/* ------------------------------------------------------------ site issues */

export type SiteIssue = { code: "NO_VIEWPORT" | "INSECURE_SCRIPT" | "OLD_JQUERY" | "OLD_WORDPRESS" | "STALE_COPYRIGHT"; detail: string };

/** Years a footer copyright can lag before it reads as neglect. */
export const STALE_COPYRIGHT_YEARS = 3;

/**
 * Problems anyone can see in a page's own markup. Not a speed test.
 *
 * A page too short to judge (an interstitial, a bot wall) returns nothing:
 * the absence of a viewport tag on a 200-byte page says nothing about the site.
 */
export function siteIssues(html: string, now: Date = new Date()): SiteIssue[] {
  if (html.length < 1_500 || !/<body[\s>]/i.test(html)) return [];
  const issues: SiteIssue[] = [];

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push({ code: "NO_VIEWPORT", detail: "no mobile viewport tag" });
  }
  const insecure = html.match(/<script[^>]+src=["']http:\/\/[^"']+/i);
  if (insecure) issues.push({ code: "INSECURE_SCRIPT", detail: "loads a script over plain http" });

  const jquery = html.match(/jquery[.-]?(1\.\d+|2\.\d+)(?:\.\d+)?(?:\.min)?\.js/i);
  if (jquery) issues.push({ code: "OLD_JQUERY", detail: `uses jQuery ${jquery[1]}, several major versions old` });

  const wp = html.match(/<meta[^>]+generator[^>]+WordPress\s+(\d+)\.(\d+)/i);
  if (wp && Number(wp[1]) < 6) issues.push({ code: "OLD_WORDPRESS", detail: `runs WordPress ${wp[1]}.${wp[2]}` });

  const footer = html.slice(-6_000);
  const years = [...footer.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));
  if (years.length > 0) {
    const latest = Math.max(...years);
    if (latest >= 1995 && now.getUTCFullYear() - latest >= STALE_COPYRIGHT_YEARS) {
      issues.push({ code: "STALE_COPYRIGHT", detail: `footer copyright still says ${latest}` });
    }
  }
  return issues;
}
