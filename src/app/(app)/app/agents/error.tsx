"use client";
import { Button } from "@/components/ui/button";
export default function ErrorState({ reset }: { reset: () => void }) { return <div className="rounded-xl border border-line bg-surface p-8"><h2 className="font-semibold">Agents could not be loaded</h2><p className="my-3 text-sm text-content-muted">Check your workspace access and try again.</p><Button onClick={reset}>Try again</Button></div>; }
