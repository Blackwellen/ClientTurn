import * as React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STOP_CONDITIONS,
  STOP_CONDITION_NOTE,
  QUIET_HOURS_NOTE,
} from "@/lib/automations/types";

export function StopConditionsPanel({
  quietHoursLabel,
}: {
  quietHoursLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-success-600 size-4" />
          Stop conditions
        </CardTitle>
        <p className="text-content-muted mt-1 flex items-start gap-1.5 text-[13px]">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            These always apply and cannot be edited away. {STOP_CONDITION_NOTE}
          </span>
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-line divide-y">
          {STOP_CONDITIONS.map((condition) => (
            <li key={condition.label} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-content text-[13px] font-medium">
                {condition.label}
              </p>
              <p className="text-content-muted mt-0.5 text-[12px]">
                {condition.detail}
              </p>
            </li>
          ))}
          <li className="py-2.5 last:pb-0">
            <p className="text-content text-[13px] font-medium">
              Quiet hours{quietHoursLabel ? ` — ${quietHoursLabel}` : ""}
            </p>
            <p className="text-content-muted mt-0.5 text-[12px]">
              {QUIET_HOURS_NOTE}
            </p>
          </li>
          <li className="py-2.5 last:pb-0">
            <p className="text-content text-[13px] font-medium">
              The sequence reaches its last step
            </p>
            <p className="text-content-muted mt-0.5 text-[12px]">
              There is no infinite chase. When the final step has been sent the
              run completes and nothing further is scheduled.
            </p>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
