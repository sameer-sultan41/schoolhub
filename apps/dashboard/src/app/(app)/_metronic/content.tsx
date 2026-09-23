"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/app/(app)/_metronic/use-mobile";

import { Breadcrumb } from "@/app/(app)/_metronic/breadcrumb";
import { Container } from "@/app/(app)/_metronic/partials/common/container";

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
