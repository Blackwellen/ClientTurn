import { NextResponse } from "next/server";
import { z } from "zod";
import { recordMarketingEvent } from "@/lib/marketing/record";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const short = z.string().trim().max(200).optional();

const bodySchema = z.object({
  eventName: z.string().trim().min(1).max(64),
  ctaPlacement: z.string().trim().max(64).optional(),
  anonymousId: z.string().trim().max(64).optional(),
  utmSource: short,
  utmMedium: short,
  utmCampaign: short,
  utmContent: short,
  utmTerm: short,
  referrer: z.string().trim().max(500).optional(),
  landingPath: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const limited = await rateLimitResponse("marketing:track", request.headers);
  if (limited) return limited;

  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = bodySchema.safeParse(parsedJson);
  if (!result.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const input = result.data;

  try {
    await recordMarketingEvent({
      eventName: input.eventName,
      ctaPlacement: input.ctaPlacement,
      metadata: input.metadata,
      session: {
        anonymousId: input.anonymousId,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        utmContent: input.utmContent,
        utmTerm: input.utmTerm,
        referrer: input.referrer,
        landingPath: input.landingPath,
      },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 202 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
