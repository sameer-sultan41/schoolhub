"use client";

import { ChildGate } from "@/features/portal/shell/child-gate";
import { ChildCard } from "./child-card";

/** `/portal/[studentId]`: the selected child's card, or not found for a foreign segment. */
export function ChildOverview() {
  return <ChildGate>{(child) => <ChildCard child={child} linked={false} />}</ChildGate>;
}
