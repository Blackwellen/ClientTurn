import { z } from "zod";
import {
  ApiError,
  apiSuccess,
  serviceFailureToApiError,
  withApiKey,
} from "@/lib/api/public";
import { runOperation } from "@/lib/services";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

async function leadId(route: RouteContext): Promise<string> {
  const { id } = await route.params;
  const parsed = idSchema.safeParse(id);
  // A malformed id is a bad request, not a missing lead. Answering 404 would
  // tell a caller their id was right and the record was gone.
  if (!parsed.success) {
    throw new ApiError("invalid_request", "That is not a valid lead id.");
  }
  return parsed.data;
}

/** `GET /api/v1/leads/{id}` — one lead, with its recent activity. */
export const GET = withApiKey<RouteContext>(
  { scope: "leads:read" },
  async (_request, context, route) => {
    const id = await leadId(route);

    const result = await runOperation<{ lead: unknown }>(
      "lead.get",
      { leadId: id },
      {
        businessId: context.businessId,
        userId: context.userId,
        role: context.userRole,
        caller: "API",
        correlationId: context.requestId,
      },
    );

    if (!result.success) throw serviceFailureToApiError(result);
    return apiSuccess({ data: result.data.lead });
  },
);

/**
 * `PATCH /api/v1/leads/{id}` — change a lead.
 *
 * Two operations sit behind one HTTP verb, and the split is not arbitrary:
 * `status` goes to `lead.set_status`, which runs the status-transition rules
 * and writes its own audit action, while the remaining fields go to
 * `lead.update`. Doing both through one generic table write would skip those
 * rules, which is exactly the drift this API is built to avoid.
 *
 * `member` is required, not `viewer`, and the service layer checks it again —
 * the wrapper's check is the early refusal, not the guard.
 *
 * A PATCH that asks for several changes is not a transaction, because the
 * service operations behind it are not one. Rather than pretend otherwise, a
 * failure part-way through reports exactly what was applied before it — a
 * caller that is told only "failed" would have to re-read the lead to find out
 * whether anything happened, and most callers would not.
 */
const patchSchema = z
  .object({
    first_name: z.string().trim().max(120).nullable().optional(),
    last_name: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    postcode: z.string().trim().max(20).nullable().optional(),
    status: z
      .enum(["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"])
      .optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const PATCH = withApiKey<RouteContext>(
  { scope: "leads:write", minimumRole: "member" },
  async (request, context, route) => {
    const id = await leadId(route);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("invalid_request", "The request body must be JSON.");
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(
        "invalid_request",
        issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid body.",
      );
    }

    const { status, note, ...fields } = parsed.data;
    const serviceContext = {
      businessId: context.businessId,
      userId: context.userId,
      role: context.userRole,
      caller: "API" as const,
      correlationId: context.requestId,
    };

    const applied: string[] = [];
    const warnings: { code: string; message: string }[] = [];

    /**
     * Runs one operation, and on failure reports what had already been applied.
     *
     * The alternative — a bare error — leaves the caller unable to tell an
     * untouched lead from a half-changed one without re-reading it.
     */
    const step = async (
      operation: string,
      args: Record<string, unknown>,
    ): Promise<void> => {
      const result = await runOperation(operation, args, serviceContext);

      if (!result.success) {
        const error = serviceFailureToApiError(result);
        throw new ApiError(error.code, error.message, {
          ...(error.details ?? {}),
          failed_step: operation,
          // Empty when nothing had been applied yet, which is itself the useful
          // answer: the lead is untouched.
          applied,
        });
      }

      applied.push(operation);
      for (const warning of result.warnings) warnings.push(warning);
    };

    // Field changes first. If the status change below is refused, the caller
    // still has a coherent record rather than a status moved onto details that
    // were never saved.
    if (Object.keys(fields).length > 0) {
      await step("lead.update", {
        leadId: id,
        firstName: fields.first_name,
        lastName: fields.last_name,
        email: fields.email,
        phone: fields.phone,
        postcode: fields.postcode,
      });
    }

    if (status) await step("lead.set_status", { leadId: id, status });

    if (note) await step("lead.add_note", { leadId: id, body: note });

    if (applied.length === 0) {
      throw new ApiError("invalid_request", "Nothing to change.");
    }

    // The lead is re-read rather than assembled from the patch, so what comes
    // back is what is actually stored — including anything the service layer
    // normalised on the way in.
    const after = await runOperation<{ lead: unknown }>(
      "lead.get",
      { leadId: id },
      serviceContext,
    );

    if (!after.success) throw serviceFailureToApiError(after);

    // Warnings travel with the success rather than being dropped. "Follow-up
    // stops for a lead marked won" is something the caller's user needs to be
    // told, and the service layer already worked it out.
    return apiSuccess({
      data: after.data.lead,
      applied,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  },
);
