import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/shell/shell";
import { SettingsProvider } from "@/app/(app)/shell/settings-provider";

import "@schoolhub/ui/styles/metronic-shell.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <Shell>{children}</Shell>
    </SettingsProvider>
  );
}
