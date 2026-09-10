/**
 * Loads every provider adapter for its side effects.
 *
 * `registry.ts` holds an empty `Map` until something imports the adapter
 * modules, because each one registers itself on import. That is a fine pattern
 * right up until only *one* consumer remembers to do the importing — which is
 * exactly what happened here.
 *
 * The adapters were imported solely by `lib/jobs/register.ts`. Background jobs
 * therefore saw a full registry, while `/api/integrations/[provider]/connect`
 * and its callback — which import `registry.ts` directly — saw an empty one and
 * answered `{"error":"Unknown provider."}` for every provider on the generic
 * OAuth flow. The Connect button rendered, the customer clicked it, and got a
 * 404 from their own app.
 *
 * Worth stating plainly because the shape recurs: a registry populated by
 * import side effects is only as complete as its least careful importer. One
 * module owns the list, and everything that reads the registry imports this
 * rather than remembering nine lines.
 */
import "@/lib/integrations/providers/google-ads";
import "@/lib/integrations/providers/microsoft-ads";
import "@/lib/integrations/providers/meta-lead-ads";
import "@/lib/integrations/providers/whatsapp-cloud";
import "@/lib/integrations/providers/tiktok-ads";
import "@/lib/integrations/providers/linkedin-ads";
import "@/lib/integrations/providers/slack";
import "@/lib/integrations/providers/hubspot";
import "@/lib/integrations/providers/zoho-crm";
