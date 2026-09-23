import type { ReactNode } from "react";

import { Shell } from "@/app/(app)/shell/shell";

import "@schoolhub/ui/styles/metronic-shell.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
