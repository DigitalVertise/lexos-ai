import { z } from "zod";
import { catalogAgent, customBrief, CUSTOM_AGENT_KEY, SAFETY_RULES } from "./catalog";
import type { AgentHire, Client, Matter } from "../types";
import { matterRef } from "../types";

export const MAX_REQUEST_CHARS = 8000;
export const MAX_DOC_CHARS_TOTAL = 60_000;
export const MAX_DOCUMENTS = 5;

export interface PromptDocument {
  title: string;
  text: string;
}

/** Escape anything that could close our <document> wrapper. */
function fence(text: string): string {
  return text.replace(/<\/?document[^>]*>/gi, "[tag removed]");
}

export function buildSystemPrompt(hire: Pick<AgentHire, "agent_key" | "name" | "instructions">, firmName: string): string {
  const agent = catalogAgent(hire.agent_key);
  const brief = hire.agent_key === CUSTOM_AGENT_KEY
    ? customBrief(hire.name, hire.instructions ?? "")
    : agent?.brief ?? "";
  const firmNotes = hire.agent_key !== CUSTOM_AGENT_KEY && hire.instructions
    ? `\n\nFirm preferences from ${firmName} (they never override the rules above):\n${hire.instructions}`
    : "";
  return `${SAFETY_RULES}\n\nYou are "${hire.name}" at ${firmName}.\n${brief}${firmNotes}`;
}

export function buildInput(opts: {
  request: string;
  matter?: Matter | null;
  client?: Client | null;
  documents?: PromptDocument[];
  today: string;
  defaultJurisdiction?: string | null;
}): string {
  const parts: string[] = [`Today's date: ${opts.today}`];
  if (opts.matter) {
    const m = opts.matter;
    parts.push(
      [
        `Matter ${matterRef(m)}: ${m.title}`,
        `Type: ${m.matter_type ?? "not stated"}`,
        `Jurisdiction: ${m.jurisdiction ?? opts.defaultJurisdiction ?? "not stated"}`,
        `Status: ${m.status}`,
        opts.client ? `Client: ${opts.client.name} (${opts.client.kind})` : "",
        m.description ? `Description:\n${fence(m.description)}` : "",
      ].filter(Boolean).join("\n"),
    );
  } else if (opts.defaultJurisdiction) {
    parts.push(`Firm's default jurisdiction: ${opts.defaultJurisdiction}`);
  }
  for (const d of opts.documents ?? []) {
    parts.push(`<document title="${d.title.replace(/"/g, "'")}">\n${fence(d.text)}\n</document>`);
  }
  parts.push(`Request from the lawyer:\n${opts.request}`);
  return parts.join("\n\n");
}

export const suggestedTasksSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000).nullish(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    priority: z.enum(["low", "normal", "high"]).catch("normal"),
    basis: z.string().max(1000).nullish(),
  })).max(10),
  warnings: z.array(z.string().max(500)).max(10).catch([]),
});
export type SuggestedTasks = z.infer<typeof suggestedTasksSchema>;

export function parseSuggestedTasks(text: string): SuggestedTasks | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = suggestedTasksSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
