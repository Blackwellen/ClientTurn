import { redirect } from "next/navigation";

/** Settings collapsed into one route with a `?section=` query. Kept so links
 *  already stored in notifications and emails still land in the right place. */
export default function RedirectConnections() {
  redirect("/app/settings?section=connections");
}
