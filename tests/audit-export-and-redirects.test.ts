import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUDIT_EXPORT_MAX_DAYS,
  auditCsvHeader,
  auditCsvLine,
  auditExportFilename,
  auditExportSchema,
  auditJsonRecord,
  exportBounds,
  mayExportAudit,
  nextPageFilter,
  type AuditRow,
} from "../src/lib/audit-export.ts";
import { safeRelativePath } from "../src/lib/security/safe-redirect.ts";
import { SUBPROCESSORS, SUBPROCESSOR_CHANGES } from "../src/lib/marketing/subprocessors.ts";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const ROW: AuditRow = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-09-28T10:00:00.123456+00:00",
  actor_user_id: "22222222-2222-4222-8222-222222222222",
  actor_type: "user",
  action: "lead.update",
  entity_type: "lead",
  entity_id: null,
  metadata: { note: "=HYPERLINK(\"x\")" },
};

describe("audit log export: input", () => {
  test("accepts a valid range and defaults to CSV", () => {
    const parsed = auditExportSchema.parse({ from: "2026-09-01", to: "2026-09-28" });
    assert.equal(parsed.format, "csv");
  });

  test("refuses reversed, malformed and over-long ranges", () => {
    assert.equal(auditExportSchema.safeParse({ from: "2026-09-28", to: "2026-09-01" }).success, false);
    assert.equal(auditExportSchema.safeParse({ from: "28/09/2026", to: "2026-09-28" }).success, false);
    assert.equal(auditExportSchema.safeParse({ from: "2025-01-01", to: "2026-09-28" }).success, false);
    assert.equal(auditExportSchema.safeParse({ from: "2026-01-01", to: "2026-01-01", format: "xml" }).success, false);
    assert.equal(AUDIT_EXPORT_MAX_DAYS, 366);
  });

  test("an inclusive day range becomes half-open UTC bounds", () => {
    assert.deepEqual(exportBounds({ from: "2026-09-01", to: "2026-09-28" }), {
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-09-29T00:00:00.000Z",
    });
  });

  test("only owners and admins may export", () => {
    assert.equal(mayExportAudit("owner"), true);
    assert.equal(mayExportAudit("admin"), true);
    assert.equal(mayExportAudit("member"), false);
    assert.equal(mayExportAudit("viewer"), false);
  });
});

describe("audit log export: output", () => {
  test("CSV rows are quoted and formula-safe; JSON keeps the structure", () => {
    assert.match(auditCsvHeader(), /^"Time \(UTC\)","Event id"/);
    const line = auditCsvLine(ROW, "=cmd@example.test");
    assert.match(line, /"'=cmd@example\.test"/);
    assert.ok(line.endsWith("\r\n"));
    const record = auditJsonRecord(ROW, null);
    assert.deepEqual(record.metadata, ROW.metadata);
    assert.equal(record.actor_email, null);
  });

  test("keyset paging continues after the last row, quoting the timestamp", () => {
    assert.equal(nextPageFilter(null), null);
    const filter = nextPageFilter(ROW)!;
    assert.equal(
      filter,
      `created_at.gt."${ROW.created_at}",and(created_at.eq."${ROW.created_at}",id.gt.${ROW.id})`,
    );
  });

  test("filename names the range and the format", () => {
    assert.equal(
      auditExportFilename({ from: "2026-09-01", to: "2026-09-28", format: "json" }),
      "clientturn-audit-log-2026-09-01-to-2026-09-28.json",
    );
  });

  test("the route is admin-only, same-origin, rate limited, audited and streamed", () => {
    const route = read("src/app/api/exports/audit/route.ts");
    assert.match(route, /isSameOriginRequest/);
    assert.match(route, /mayExportAudit\(workspace\.role\)/);
    assert.match(route, /checkRateLimit\("app:audit_export"/);
    assert.match(route, /action: "audit_log\.exported"/);
    assert.match(route, /new ReadableStream/);
    assert.match(route, /\.eq\("business_id", businessId\)/);
    assert.match(read("src/lib/security/rate-limit.ts"), /"app:audit_export": \{ limit: 5, windowSeconds: 3600 \}/);
  });
});

describe("open redirect guard (IR-01)", () => {
  test("keeps our own paths", () => {
    for (const ok of ["/app", "/app/leads?x=1#y", "/affiliates/app", "/api/billing/portal"]) {
      assert.equal(safeRelativePath(ok), ok);
    }
  });

  test("refuses every way of reaching another origin", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      " /app",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      null,
      42,
    ]) {
      assert.equal(safeRelativePath(bad), null, JSON.stringify(bad));
    }
  });

  test("every redirect sanitiser uses it", () => {
    for (const file of [
      "src/lib/auth/destination.ts",
      "src/app/(auth)/login/page.tsx",
      "src/app/auth/callback/route.ts",
      "src/app/api/auth/google/connect/route.ts",
    ]) {
      assert.match(read(file), /safeRelativePath\(/, file);
    }
  });
});

describe("sub-processor register and DPA", () => {
  test("lists the live providers and none of the disabled enrichment vendors", () => {
    const names = SUBPROCESSORS.map((row) => row.name.toLowerCase()).join(" | ");
    for (const live of ["supabase", "vercel", "stripe", "cloudflare r2", "azure openai", "twilio", "resend", "retell ai", "google places", "google calendar", "meta"]) {
      assert.ok(names.includes(live), `${live} missing`);
    }
    for (const vendor of ["apollo", "hunter", "clearbit"]) assert.ok(!names.includes(vendor), vendor);
    assert.ok(SUBPROCESSOR_CHANGES.some((entry) => /Google Places/.test(entry.change)));
  });

  test("the DPA exists, links the register, and states only facts we hold", () => {
    const dpa = read("src/app/(marketing)/dpa/page.tsx");
    const company = read("src/lib/marketing/company.ts");
    assert.match(dpa, /href="\/sub-processors"/);
    assert.match(dpa, /Article 28/);
    // The ICO number comes from COMPANY (verified on the ICO register 2026-09-29),
    // with the placeholder kept only as the fallback for an empty value.
    assert.match(dpa, /COMPANY\.icoRegistration/);
    assert.match(company, /icoRegistration: "ZC160806"/);
    // Retell's region as Retell publishes it (privacy policy checked 2026-09-29).
    assert.match(dpa, /Retell AI \(the optional AI voice agent\) processes and stores call\s+data in the United States/);
    assert.doesNotMatch(dpa, /owner to supply from the signed Retell DPA/);
    assert.doesNotMatch(dpa, /restore-tested/);
  });
});
