import "server-only";
import { audit } from "../audit";
import type { Workspace } from "../auth";
import { aiProvider, AIUnavailableError } from "../ai/provider";
import { extractText } from "../documents";
import { canRun } from "../entitlements";
import { monthlyRuns, userRunsLastMinute } from "./usage";
import { notionPageId, type NotionTokens } from "../integrations/notion";
import { loadConnection } from "../integrations/store";
import { planState } from "../plans";
import type { AgentHire, Client, DocumentRow, Matter } from "../types";
import { catalogAgent } from "./catalog";
import {
  buildInput, buildSystemPrompt, MAX_DOC_CHARS_TOTAL, MAX_DOCUMENTS, MAX_REQUEST_CHARS,
  parseSuggestedTasks, type SuggestedTasks,
} from "./prompt";

export interface RunInput {
  hireId: string;
  matterId: string | null;
  documentIds: string[];
  request: string;
}

export type RunResult =
  | { ok: true; outputId: string; text: string; tasks: SuggestedTasks | null }
  | { ok: false; error: string };

export async function runAssistant(ws: Workspace, input: RunInput): Promise<RunResult> {
  const request = input.request.trim();
  if (request.length < 5) return { ok: false, error: "Describe what you need in a sentence or two." };
  if (request.length > MAX_REQUEST_CHARS) return { ok: false, error: `Keep the request under ${MAX_REQUEST_CHARS} characters; attach long material as documents.` };
  if (input.documentIds.length > MAX_DOCUMENTS) return { ok: false, error: `Select up to ${MAX_DOCUMENTS} documents.` };
  if (input.documentIds.length && !input.matterId) return { ok: false, error: "Documents can only be used within a matter." };

  const db = ws.supabase;
  // Every lookup is scoped to the current org AND passes RLS.
  const { data: hire } = await db.from("agent_hires").select("*")
    .eq("id", input.hireId).eq("org_id", ws.org.id).maybeSingle<AgentHire>();
  if (!hire) return { ok: false, error: "Assistant not found." };
  if (hire.status !== "active") return { ok: false, error: `${hire.name} is paused.` };

  // Package limits.
  const state = planState(ws.org);
  const [monthCount, minuteCount] = await Promise.all([monthlyRuns(ws), userRunsLastMinute(ws)]);
  const allowed = canRun(state, monthCount, minuteCount);
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  let matter: Matter | null = null;
  let client: Client | null = null;
  const documents: { title: string; text: string }[] = [];
  if (input.matterId) {
    const { data } = await db.from("matters").select("*").eq("id", input.matterId).eq("org_id", ws.org.id).maybeSingle<Matter>();
    if (!data) return { ok: false, error: "Matter not found." };
    matter = data;
    const { data: c } = await db.from("clients").select("*").eq("id", matter.client_id).eq("org_id", ws.org.id).maybeSingle<Client>();
    client = c;
    if (input.documentIds.length) {
      const { data: docs } = await db.from("documents").select("*")
        .eq("org_id", ws.org.id).eq("matter_id", matter.id).in("id", input.documentIds).returns<DocumentRow[]>();
      if (!docs || docs.length !== input.documentIds.length) return { ok: false, error: "One or more documents were not found on this matter." };
      const perDoc = Math.floor(MAX_DOC_CHARS_TOTAL / docs.length);
      const needsNotion = docs.some((d) => d.source === "link" && d.url && notionPageId(d.url));
      const notion = needsNotion ? await loadConnection<NotionTokens>(db, ws.org.id, "notion") : null;
      for (const d of docs) {
        documents.push({ title: d.title, text: await extractText(db, d, perDoc, { notionToken: notion?.tokens.token }) });
      }
    }
  }

  const agent = catalogAgent(hire.agent_key);
  const system = buildSystemPrompt(hire, ws.org.name);
  const prompt = buildInput({
    request, matter, client, documents,
    today: new Date().toISOString().slice(0, 10),
    defaultJurisdiction: ws.org.default_jurisdiction,
  });

  let result;
  try {
    result = await aiProvider().complete({ system, input: prompt, maxOutputTokens: 8000 });
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      return { ok: false, error: "The AI service is not configured yet. An administrator needs to add the OpenAI key." };
    }
    console.error("assistant run failed", { agent: hire.agent_key, name: (err as Error).name });
    return { ok: false, error: "The AI service did not respond. Please try again in a moment." };
  }
  const text = result.text.trim();
  if (!text) return { ok: false, error: "The assistant returned an empty answer. Please rephrase and try again." };
  const tasks = agent?.output === "tasks" ? parseSuggestedTasks(text) : null;

  const { data: saved, error } = await db.from("ai_outputs").insert({
    org_id: ws.org.id,
    matter_id: matter?.id ?? null,
    agent_hire_id: hire.id,
    agent_key: hire.agent_key,
    workflow: agent?.key ?? "custom",
    instructions: request,
    output: text,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    created_by: ws.user.id,
  }).select("id").single();
  if (error || !saved) return { ok: false, error: "The answer could not be saved. Please try again." };

  await audit(ws, "assistant.run", { type: "ai_output", id: saved.id }, {
    agent: hire.agent_key,
    matter: matter ? matter.id : null,
    documents: documents.length,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
  });

  return { ok: true, outputId: saved.id, text, tasks };
}
