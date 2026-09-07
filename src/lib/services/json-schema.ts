import "server-only";
import { z } from "zod";

/**
 * The JSON Schema an MCP client is shown for a tool's arguments.
 *
 * Generated from the operation's own Zod schema rather than declared beside it.
 * The alternative — writing the JSON Schema by hand next to the validator —
 * means two descriptions of the same thing, and they drift the first time a
 * field becomes optional in one and not the other. Deriving it guarantees that
 * the schema an assistant is shown is the schema its arguments are checked
 * against.
 *
 * Zod 4 ships the conversion, so this module is a thin, deliberate wrapper
 * around it: `io: "input"` because a client is composing a request, not reading
 * a response, and the `$schema` key is dropped because MCP's `inputSchema` is
 * already understood to be JSON Schema and the extra key only adds noise to
 * every `tools/list`.
 */

export type JsonSchema = Record<string, unknown>;

export class UnsupportedSchemaError extends Error {}

/**
 * A tool's arguments as MCP expects them: always an object, even when the
 * operation takes nothing.
 *
 * A schema that cannot be represented is an error rather than a permissive
 * `{}`. Advertising "any object accepted" would invite an assistant to guess,
 * and its guesses would then be refused by validation it was never shown.
 */
export function toolInputSchema(schema: z.ZodType): JsonSchema {
  let generated: JsonSchema;
  try {
    generated = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  } catch (error) {
    throw new UnsupportedSchemaError(
      error instanceof Error ? error.message : "This schema cannot be described.",
    );
  }

  delete generated.$schema;

  if (generated.type !== "object") {
    throw new UnsupportedSchemaError("A tool's arguments must be an object.");
  }

  // `.refine()` on an object produces an `allOf` wrapper in some shapes; MCP
  // clients vary in how well they handle it, and the properties are what an
  // assistant actually needs, so the object form is required here.
  if (!generated.properties) {
    generated.properties = {};
  }

  return generated;
}
