import type { ReactNode } from "react";

import { AudienceGate } from "@/components/audience-gate";
import { PortalShell } from "@/features/portal/shell/portal-shell";

// Routing-only guard: `AudienceGate` sends staff to the dashboard once `/auth/me` resolves;
// src/proxy.ts has already sent a visitor with no session to /login.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AudienceGate audience="portal">
      <PortalShell>{children}</PortalShell>
    </AudienceGate>
  );
}
