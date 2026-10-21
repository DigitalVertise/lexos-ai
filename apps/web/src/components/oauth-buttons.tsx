import { signInWithProvider } from "@/app/(auth)/actions";
import type { OAuthProvider } from "@/lib/oauth";

const LABEL: Record<OAuthProvider, string> = { google: "Continue with Google", apple: "Continue with Apple" };

function Icon({ provider }: { provider: OAuthProvider }) {
  if (provider === "google") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.1-4.2ZM13.9 5a4.4 4.4 0 0 0 1-3.2 4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1.1 3.1A3.7 3.7 0 0 0 13.9 5Z" />
    </svg>
  );
}

/** Renders nothing until at least one provider is enabled in Supabase Auth. */
export function OAuthButtons({ providers, next }: { providers: OAuthProvider[]; next?: string }) {
  if (providers.length === 0) return null;
  return (
    <div className="mt-5 space-y-2">
      {providers.map((p) => (
        <form key={p} action={signInWithProvider}>
          <input type="hidden" name="provider" value={p} />
          <input type="hidden" name="next" value={next ?? ""} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
          >
            <Icon provider={p} />
            {LABEL[p]}
          </button>
        </form>
      ))}
      <div className="flex items-center gap-3 pt-2 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
