"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "./use-mobile";

import { Breadcrumb } from "./breadcrumb";
import { Container } from "./partials/common/container";

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
