import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/shell/shell";
import { AudienceGate } from "@/components/audience-gate";
import { PlatformMfaGate } from "@/features/platform/platform-mfa-gate";
import { SettingsProvider } from "@/providers/settings-provider";

import "@schoolhub/ui/styles/metronic-shell.css";

// The platform console's shell: operators only (a school's user is sent to its own home), and an
// operator without TOTP is sent to enrol first. Routing only; the API enforces both (ADR-0036).
// `proxy.ts` has already 404'd `/platform/*` on a school's host.
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AudienceGate audience="platform">
        <PlatformMfaGate>
          <Shell>{children}</Shell>
        </PlatformMfaGate>
      </AudienceGate>
    </SettingsProvider>
  );
}
