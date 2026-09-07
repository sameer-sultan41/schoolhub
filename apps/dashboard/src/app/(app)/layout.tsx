import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

/**
 * Authenticated route group. The proxy has already established that a session cookie
 * exists; `AppShell` resolves the actual user (and therefore the tenant branding and the
 * permission-filtered navigation) client-side.
 *
 * Layout preferences are not read here: the root layout already resolves them from cookies
 * and seeds PreferencesProvider, whose context reaches this subtree during SSR as well as
 * in the browser.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
