"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@schoolhub/ui";

import { Breadcrumb } from "@/app/(app)/shell/breadcrumb";
import { Container } from "@/app/(app)/shell/partials/common/container";

// Ported verbatim from packages/ui's layouts/demo1/components/content.tsx.
export function Content({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();

  return (
    <div className="content grow pt-5" role="content">
      {mobile && (
        <Container>
          <Breadcrumb />
        </Container>
      )}
      {children}
    </div>
  );
}
