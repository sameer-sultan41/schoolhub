"use client";

import type { ReactNode } from "react";

// Ported from packages/ui's layouts/demo1/components/content.tsx — trimmed of its own
// mobile-only Breadcrumb: the header now renders the app's one breadcrumb trail on every
// breakpoint (see header.tsx), so a second copy here would repeat it under itself.
export function Content({ children }: { children: ReactNode }) {
  return (
    <div className="content grow pt-5" role="content">
      {children}
    </div>
  );
}
