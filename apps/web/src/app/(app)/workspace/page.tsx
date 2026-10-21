import { ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";
import { EmbeddedApp } from "@/components/embedded-app";
import { PageHeader } from "@/components/ui";
import { WORKSPACE_URL } from "@/lib/embeds";

export const metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Workspace"
        description="Your firm's projects, boards and pipelines. Assign work to people or to your AI team in one place."
        actions={
          <>
            <Link href="/settings#integrations" className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm hover:bg-surface-2">
              <Link2 className="h-4 w-4" aria-hidden /> Connect Notion (optional)
            </Link>
            <a href={WORKSPACE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:opacity-90">
              Open full screen <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </>
        }
      />
      <EmbeddedApp src={WORKSPACE_URL} title="Workspace" className="h-[calc(100dvh-14rem)] min-h-[520px]" />
    </div>
  );
}
