import { screen } from "@testing-library/react";

import en from "../../../../messages/en.json";
import ur from "../../../../messages/ur.json";
import { PORTAL_STATUSES } from "@/services/modules/students/students-constant";
import { renderWithProviders } from "@/test-utils";

import { PortalStatusBadge } from "../portal-status-badge";

describe("PortalStatusBadge", () => {
  it.each([
    ["none", "No account"],
    ["invited", "Invitation sent"],
    ["expired", "Invitation expired"],
    ["send_failed", "Invitation not delivered"],
    ["active", "Active"],
    ["inactive", "Access ended"],
  ] as const)("labels %s as %s, never the raw value", (status, label) => {
    renderWithProviders(<PortalStatusBadge status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("has an English and an Urdu label for every portal status (L32)", () => {
    for (const status of PORTAL_STATUSES) {
      expect(en.students.portal.status[status]).toBeTruthy();
      expect(ur.students.portal.status[status]).toBeTruthy();
    }
  });
});
