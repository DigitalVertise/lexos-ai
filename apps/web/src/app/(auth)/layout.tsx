import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <Link href="/" className="font-display mb-8 text-xl font-semibold">Lex<span className="text-gold">OS</span> AI</Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
