import { screen } from "@testing-library/react";
import { badgeVariants, cn } from "@schoolhub/ui";

import type { PromotionStatus } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { PromotionStatusBadge } from "../promotion-status-badge";

type Variant = "secondary" | "warning" | "info" | "success" | "destructive";

/** The label and theme variant each status must show, written out here and not read back from
 * the component, so a changed mapping fails. */
const EXPECTED: [PromotionStatus, string, Variant][] = [
  ["draft", "Draft", "secondary"],
  ["pending_approval", "Pending approval", "warning"],
  ["approved", "Approved", "info"],
  ["executed", "Executed", "success"],
  ["reverted", "Reverted", "destructive"],
];

/** The classes the badge gets for `variant`: the same `badgeVariants` call the component makes. */
function classesFor(variant: Variant) {
  return cn(badgeVariants({ variant, size: "lg", appearance: "light", shape: "circle" }));
}

describe("PromotionStatusBadge", () => {
  it.each(EXPECTED)("shows %s as %s in the %s variant", (status, label, variant) => {
    renderWithProviders(<PromotionStatusBadge status={status} />);

    expect(screen.getByText(label).className).toBe(classesFor(variant));
  });

  it("gives every status a look of its own, so a wrong variant can't pass unseen", () => {
    const looks = EXPECTED.map(([, , variant]) => classesFor(variant));

    expect(new Set(looks).size).toBe(EXPECTED.length);
  });
});
