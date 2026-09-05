import { Skeleton } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function NewReactivationLoading() {
  return (
    <div className="space-y-4" aria-busy>
      <div>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-3.5 w-80" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
