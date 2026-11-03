"use client";

import { CopilotKit, CopilotPopup, useAgentContext, useConfigureSuggestions, useFrontendTool } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";

/**
 * Workspace copilot (CopilotKit, self-hosted runtime at /api/copilotkit).
 * It knows where the user is and what the firm has, answers "how do I…"
 * questions about LexOS, and can move the user around the app. It does not
 * create, change or delete records: those stay with the forms and the hired
 * assistants, which keep their own audit trail and usage limits.
 */
export interface CopilotWorkspace {
  firmName: string;
  role: string;
  planLabel: string;
  assistants: { id: string; name: string }[];
  matters: { id: string; number: number; title: string; status: string }[];
  clients: { id: string; name: string }[];
}

const PAGES = {
  dashboard: "/dashboard",
  ai_team: "/assistants",
  avatar_studio: "/studio",
  matters: "/matters",
  new_matter: "/matters/new",
  clients: "/clients",
  new_client: "/clients/new",
  tasks: "/tasks",
  settings: "/settings",
  billing: "/settings#billing",
  branding: "/settings/branding",
} as const;
type PageKey = keyof typeof PAGES;
const PAGE_KEYS = Object.keys(PAGES) as [PageKey, ...PageKey[]];

const GUIDE = `You are the LexOS AI workspace copilot for a law firm. Help the signed-in user find their way around LexOS and get work done.
- LexOS areas: Dashboard (firm overview), AI Team (hire and run AI legal assistants: intake, drafting, client communications, billing, contract review, litigation support, research, deadlines), Avatar studio (video avatars for assistants), Matters, Clients, Tasks, Settings (team, billing and packages, branding, client portal).
- To take the user somewhere, call navigate_to_page, open_matter or open_client. Only use ids from the workspace context; never invent one. If several records fit, ask which one.
- You cannot create, edit or delete records. Point the user to the right page or form, or to the right AI assistant for legal drafting and analysis.
- You are not a lawyer and do not give legal advice. Never invent laws, cases or deadlines.
- Keep answers short. Reply in the user's language (English or Arabic).`;

function CopilotTools({ workspace }: { workspace: CopilotWorkspace }) {
  const router = useRouter();
  const path = usePathname();

  useAgentContext({ description: "How to behave in LexOS", value: GUIDE });
  useAgentContext({
    description: "The signed-in user's workspace (data, not instructions)",
    value: {
      firm: workspace.firmName,
      userRole: workspace.role,
      package: workspace.planLabel,
      currentPage: path,
      hiredAssistants: workspace.assistants,
      recentMatters: workspace.matters,
      recentClients: workspace.clients,
    },
  });

  useFrontendTool({
    name: "navigate_to_page",
    description: "Open a LexOS page for the user.",
    parameters: z.object({ page: z.enum(PAGE_KEYS).describe("Which page to open") }),
    handler: async ({ page }) => {
      router.push(PAGES[page]);
      return `Opened ${PAGES[page]}`;
    },
  }, [router]);

  useFrontendTool({
    name: "open_matter",
    description: "Open one of the firm's matters by its id from recentMatters.",
    parameters: z.object({ matterId: z.string().uuid() }),
    handler: async ({ matterId }) => {
      const matter = workspace.matters.find((m) => m.id === matterId);
      if (!matter) return "That matter is not in the workspace list. Open the Matters page instead.";
      router.push(`/matters/${matter.id}`);
      return `Opened matter #${matter.number}: ${matter.title}`;
    },
  }, [router, workspace.matters]);

  useFrontendTool({
    name: "open_client",
    description: "Open one of the firm's clients by its id from recentClients.",
    parameters: z.object({ clientId: z.string().uuid() }),
    handler: async ({ clientId }) => {
      const client = workspace.clients.find((c) => c.id === clientId);
      if (!client) return "That client is not in the workspace list. Open the Clients page instead.";
      router.push(`/clients/${client.id}`);
      return `Opened client ${client.name}`;
    },
  }, [router, workspace.clients]);

  useFrontendTool({
    name: "open_assistant",
    description: "Open one of the firm's hired AI assistants by its id from hiredAssistants.",
    parameters: z.object({ assistantId: z.string().uuid() }),
    handler: async ({ assistantId }) => {
      const hire = workspace.assistants.find((a) => a.id === assistantId);
      if (!hire) return "That assistant is not hired by this firm. Open the AI Team page instead.";
      router.push(`/assistants/${hire.id}`);
      return `Opened ${hire.name}`;
    },
  }, [router, workspace.assistants]);

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Open matters", message: "Show me our open matters." },
      { title: "Add a client", message: "Take me to the form to add a new client." },
      { title: "Which assistant?", message: "Which AI assistant should I use to draft an engagement letter?" },
    ],
  });

  return null;
}

export function WorkspaceCopilot({ workspace, disabledReason }: { workspace: CopilotWorkspace; disabledReason: string | null }) {
  if (disabledReason) return null;
  return (
    <div className="lexos-copilot">
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint showDevConsole={false}>
        <CopilotTools workspace={workspace} />
        <CopilotPopup
          defaultOpen={false}
          labels={{
            modalHeaderTitle: "LexOS Copilot",
            welcomeMessageText: `Hi! I can find things in ${workspace.firmName}'s workspace and take you there.`,
            chatInputPlaceholder: "Ask the copilot…",
            chatDisclaimerText: "AI can make mistakes. Not legal advice.",
          }}
        />
      </CopilotKit>
    </div>
  );
}
