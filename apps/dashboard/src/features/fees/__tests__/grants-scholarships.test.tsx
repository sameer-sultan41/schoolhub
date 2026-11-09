import type * as ReactModule from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { pick } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { ScholarshipsTab } from "@/features/fees/grants/scholarships-tab";
import { asUser, cursorPage, ruleViolation, SESSION_ID } from "./fees-test-support";
import {
  createScholarship,
  GRANTS_PERMISSIONS,
  listScholarships,
  SCHOLARSHIP_ID,
  scholarshipRecord,
  stubGrantsServices,
  updateScholarship,
} from "./grants-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

// The picker searches the students list; a stand-in that picks one student keeps this file on the form.
jest.mock("@/components/student-picker", () => {
  const react = jest.requireActual<typeof ReactModule>("react");
  return {
    StudentPicker: ({ onChange }: { onChange: (value: { id: string; name: string }) => void }) =>
      react.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            onChange({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Ayesha Khan" });
          },
        },
        "Choose a student",
      ),
  };
});

async function renderTab() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ScholarshipsTab />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

/** The names of the status-move buttons the single row offers. */
function moveButtons() {
  return screen
    .queryAllByRole("button", { name: /: Merit award$/ })
    .map((button) => button.getAttribute("aria-label"));
}

describe("scholarships tab", () => {
  beforeEach(() => {
    stubGrantsServices("/fees/grants?tab=scholarships");
  });

  it("shows each award with its coverage, sponsor and status", async () => {
    asUser("fees.discount.view", "school.academic-session.view");
    await renderTab();

    expect(await screen.findByText("Merit award")).toBeInTheDocument();
    expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Alumni trust")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(await screen.findByText("2026-27")).toBeInTheDocument();
  });

  it.each([
    ["applied", ["Approve: Merit award", "Revoke: Merit award"]],
    ["approved", ["Activate: Merit award", "Revoke: Merit award"]],
    ["active", ["End: Merit award", "Revoke: Merit award"]],
    ["ended", []],
    ["revoked", []],
  ] as const)("offers an award that is %s only its legal next moves", async (status, expected) => {
    listScholarships.mockResolvedValue(cursorPage([scholarshipRecord({ status })]));
    asUser("fees.discount.view", "fees.scholarship.create");
    await renderTab();

    await screen.findByText("Merit award");
    expect(moveButtons()).toEqual(expected);
  });

  it("never offers a way back from a revoked award", async () => {
    listScholarships.mockResolvedValue(cursorPage([scholarshipRecord({ status: "revoked" })]));
    asUser("fees.discount.view", "fees.scholarship.create");
    await renderTab();

    await screen.findByText("Merit award");
    expect(screen.queryByRole("button", { name: /Activate|Approve/ })).not.toBeInTheDocument();
  });

  it("hides every status move from a viewer without the create key", async () => {
    listScholarships.mockResolvedValue(cursorPage([scholarshipRecord({ status: "active" })]));
    asUser("fees.discount.view");
    await renderTab();

    await screen.findByText("Merit award");
    expect(moveButtons()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Add scholarship" })).not.toBeInTheDocument();
  });

  it("offers no Add scholarship to a creator who cannot read the students or sessions its form needs", async () => {
    asUser("fees.discount.view", "fees.scholarship.create");
    await renderTab();

    await screen.findByText("Merit award");
    expect(screen.queryByRole("button", { name: "Add scholarship" })).not.toBeInTheDocument();
  });

  it("moves an award on with optional notes left unsent", async () => {
    updateScholarship.mockResolvedValue(scholarshipRecord({ status: "active" }));
    asUser("fees.discount.view", "fees.scholarship.create");
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Activate: Merit award" }));
    const dialog = await screen.findByRole("dialog", { name: "Activate: Merit award" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(updateScholarship).toHaveBeenCalledWith(SCHOLARSHIP_ID, {
        status: "active",
        notes: undefined,
      });
    });
  });

  it.each([
    ["active", "End: Merit award", "ended"],
    ["approved", "Revoke: Merit award", "revoked"],
  ] as const)("requires notes to end or revoke (%s -> %s)", async (status, action, to) => {
    listScholarships.mockResolvedValue(cursorPage([scholarshipRecord({ status })]));
    updateScholarship.mockResolvedValue(scholarshipRecord({ status: to }));
    asUser("fees.discount.view", "fees.scholarship.create");
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: action }));
    const dialog = await screen.findByRole("dialog", { name: action });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(updateScholarship).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Notes (required)"), "Family withdrew");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(updateScholarship).toHaveBeenCalledWith(SCHOLARSHIP_ID, {
        status: to,
        notes: "Family withdrew",
      });
    });
  });

  it("shows the server's refusal of a move inline and keeps the dialog open", async () => {
    // A race: the award was revoked after the page loaded, so the server refuses the Activate asked for.
    const refusal = "A revoked award cannot become active. Allowed next: none, it is final.";
    updateScholarship.mockRejectedValue(ruleViolation("status", refusal));
    asUser("fees.discount.view", "fees.scholarship.create");
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Activate: Merit award" }));
    const dialog = await screen.findByRole("dialog", { name: "Activate: Merit award" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Activate: Merit award" })).toBeInTheDocument();
  });

  it("adds an award for the picked student and session, starting as applied", async () => {
    createScholarship.mockResolvedValue(scholarshipRecord({ status: "applied" }));
    asUser(...GRANTS_PERMISSIONS);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Add scholarship" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a scholarship" });
    await user.click(within(dialog).getByRole("button", { name: "Choose a student" }));
    await pick(user, "Session", "2026-27");
    await user.type(within(dialog).getByLabelText("Name"), "Merit award");
    await user.type(within(dialog).getByLabelText("Value"), "50");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createScholarship).toHaveBeenCalledWith({
        studentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        academicSessionId: SESSION_ID,
        name: "Merit award",
        scholarshipType: "merit",
        coverageType: "percent",
        value: "50",
        sponsor: null,
        status: "applied",
        notes: null,
      });
    });
  });
});
