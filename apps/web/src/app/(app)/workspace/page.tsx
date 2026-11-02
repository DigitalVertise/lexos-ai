import { redirect } from "next/navigation";

/** The embedded third-party workspace was removed; keep old links working. */
export default function WorkspacePage() {
  redirect("/dashboard");
}
