import type { ReactNode } from "react";

import { Shell } from "./_metronic/shell";
import { SettingsProvider } from "./_metronic/settings-provider";

import "./metronic-extras.css";

// Dev-only live Metronic Demo1 preview — see page.tsx for the production gate.
export default function MetronicDemo1Layout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <Shell>{children}</Shell>
    </SettingsProvider>
  );
}
