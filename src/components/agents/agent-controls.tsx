"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { controlAgent } from "@/lib/agents/actions";

export function AgentControls({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  function run(command: string) { start(async () => { try { const result = await controlAgent(id, command); setError(result.error ?? ""); router.refresh(); } catch { setError("You need workspace admin access to change this agent."); } }); }
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button loading={pending} onClick={() => run("run")}><Play className="size-4" />{status === "ACTIVE" ? "Run now" : "Start agent"}</Button><Button variant="secondary" disabled={pending || status !== "ACTIVE"} onClick={() => run("pause")}><Pause className="size-4" />Pause</Button><Button variant="ghost" disabled={pending || status === "STOPPED"} onClick={() => run("stop")}><Square className="size-4" />Stop</Button></div>{error && <p role="alert" className="max-w-lg text-sm text-danger-600">{error}</p>}</div>;
}
