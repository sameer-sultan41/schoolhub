import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/_metronic/shell";
import { SettingsProvider } from "@/app/(app)/_metronic/settings-provider";

import "@/app/(app)/metronic-extras.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <Shell>{children}</Shell>
    </SettingsProvider>
  );
}
