import { Suspense } from "react";

import { PortalMessages } from "@/features/portal/messages/portal-messages";

// The screen reads `useSearchParams` (the open thread), so it sits under a `Suspense` boundary.
export default function PortalMessagesPage() {
  return (
    <Suspense>
      <PortalMessages />
    </Suspense>
  );
}
