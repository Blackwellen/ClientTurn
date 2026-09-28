import { PageSkeleton } from "@/components/ui/skeleton-page";

/** Partner portal skeleton while the ledger reads run (affiliate audit 17 §5). */
export default function Loading() {
  return <PageSkeleton kpis={4} rows={6} />;
}
