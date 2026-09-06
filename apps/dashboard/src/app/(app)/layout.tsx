import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { readPreferencesFromCookies } from "@/lib/preferences/preferences-cookies";

/**
 * Authenticated route group. The proxy has already established that a session cookie
 * exists; `AppShell` resolves the actual user (and therefore the tenant branding and the
 * permission-filtered navigation) client-side.
 *
 * The layout preferences are resolved HERE and passed down, even though the shell could
 * read them from context: the sidebar's variant, its collapse mode and whether it starts
 * open all decide the server's own markup, and reading them client-side would render the
 * default shell first and snap to the viewer's on hydration. `cookies()` is deduped
 * within a request, so this costs nothing over the root layout's own read.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const preferences = await readPreferencesFromCookies();
  return <AppShell preferences={preferences}>{children}</AppShell>;
}
