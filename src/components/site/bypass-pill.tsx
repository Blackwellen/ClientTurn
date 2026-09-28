import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/** The pill itself; `MaintenanceBypassPill` / `MarketingBypassPill` decide whether it shows. */
export function BypassPill({ label }: { label: string }) {
  return (
    <Link
      href="/admin/site"
      className="fixed bottom-4 left-4 z-[80] inline-flex items-center gap-1.5 rounded-full border border-warning-100 bg-warning-50 px-3 py-1.5 text-[12px] font-semibold text-warning-700 shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
    >
      <ShieldAlert className="size-3.5" aria-hidden />
      Maintenance bypass · {label}
      <span className="sr-only">. Customers see the maintenance page. Open site controls.</span>
    </Link>
  );
}
