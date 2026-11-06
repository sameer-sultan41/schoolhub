import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/shell/shell";
import { AudienceGate } from "@/components/audience-gate";
import { SettingsProvider } from "@/providers/settings-provider";

import "@schoolhub/ui/styles/metronic-shell.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AudienceGate audience="staff">
        <Shell>{children}</Shell>
      </AudienceGate>
    </SettingsProvider>
  );
}
