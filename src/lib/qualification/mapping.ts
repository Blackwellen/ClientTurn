/**
 * Which qualification detail a configured question answers, and which library
 * question intent it is (0134 `qualification_questions.dimension_key` /
 * `question_intent_key`). Explicit mapping replaces guessing the dimension
 * from the wording; a question with neither stays a custom question. Only
 * library intent keys are stored: `custom:<id>` is synthesised in code.
 *
 * A module of its own, not `./types.ts`: the qualification-intelligence
 * contract imports `./types.ts`, so importing the contract back from there
 * would be a cycle.
 *
 * Pure: no `server-only`, no Supabase.
 */

import { z } from "zod";
import {
  LIBRARY_INTENT_KEY_PATTERN,
  qiDimensionKeySchema,
} from "../qualification-intelligence/types.ts";

export const questionMappingSchema = z.object({
  questionId: z.uuid(),
  dimensionKey: qiDimensionKeySchema.nullable(),
  questionIntentKey: z
    .string()
    .trim()
    .regex(LIBRARY_INTENT_KEY_PATTERN, "A question key looks like TIMING.START_WINDOW.")
    .nullable(),
});

export type QuestionMapping = z.infer<typeof questionMappingSchema>;

/** The family of a library intent key ("TIMING.START_WINDOW" -> "TIMING"). */
export function intentKeyFamily(key: string | null): string | null {
  if (!key) return null;
  return key.split(".")[0] || null;
}
