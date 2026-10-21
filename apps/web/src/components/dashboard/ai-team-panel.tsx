import { Bot, MessageSquare, Mic, Video } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "../ui";
import { catalogAgent } from "@/lib/agents/catalog";

export interface TeamHire {
  id: string;
  agent_key: string;
  name: string;
  status: "active" | "paused";
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "AI";

/** "Your AI team": hired assistants with an online pulse and Chat / Voice / Avatar quick actions. */
export function AiTeamPanel({ hires, total, canHire }: { hires: TeamHire[]; total: number; canHire: boolean }) {
  if (hires.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/12 text-accent"><Bot className="h-6 w-6" aria-hidden /></span>
        <p className="mt-3 font-medium">Hire your AI legal team</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Intake, drafting, client communication and billing assistants, ready in minutes and working under your supervision.</p>
        <div className="mt-4 flex justify-center"><ButtonLink href="/assistants">{canHire ? "Choose assistants" : "View packages"}</ButtonLink></div>
      </div>
    );
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {hires.map((h) => {
          const online = h.status === "active";
          return (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
              <Link href={`/assistants/${h.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/12 text-sm font-semibold text-accent">
                  {initials(h.name)}
                  <span className="absolute -bottom-0.5 -right-0.5 grid h-3 w-3 place-items-center rounded-full bg-surface">
                    <span className={`relative h-2 w-2 rounded-full ${online ? "bg-ok" : "bg-muted"}`}>
                      {online && <span className="dv-ping absolute inset-0 rounded-full bg-ok" />}
                    </span>
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.name}</span>
                  <span className="block truncate text-xs text-muted">{catalogAgent(h.agent_key)?.title ?? "Custom assistant"} · {online ? "Online" : "Paused"}</span>
                </span>
              </Link>
              <div className="flex shrink-0 gap-1.5">
                <ActionLink href={`/assistants/${h.id}?mode=chat`} label={`Chat with ${h.name}`} Icon={MessageSquare} text="Chat" />
                <ActionLink href={`/assistants/${h.id}?mode=voice`} label={`Voice with ${h.name}`} Icon={Mic} text="Voice" />
                <ActionLink href={`/studio/${h.id}`} label={`Avatar studio for ${h.name}`} Icon={Video} text="Avatar" />
              </div>
            </li>
          );
        })}
      </ul>
      {total > hires.length && (
        <Link href="/assistants" className="block border-t border-line px-4 py-2.5 text-center text-sm text-accent hover:bg-surface-2">View all {total} assistants</Link>
      )}
    </>
  );
}

function ActionLink({ href, label, Icon, text }: { href: string; label: string; Icon: typeof Bot; text: string }) {
  return (
    <Link href={href} aria-label={label} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent/50 hover:text-accent">
      <Icon className="h-3.5 w-3.5" aria-hidden /> {text}
    </Link>
  );
}
