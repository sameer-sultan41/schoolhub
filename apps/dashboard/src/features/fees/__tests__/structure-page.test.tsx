import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { StructurePage } from "@/features/fees/structures/detail/structure-page";
import {
  FEES_SETUP_AUTHOR_PERMISSIONS,
  activateFeeStructure,
  archiveFeeStructure,
  asUser,
  createFeeSchedule,
  fetchFeeStructure,
  HEAD_ID,
  ruleViolation,
  scheduleRecord,
  stubFeesServices,
  structureRecord,
  STRUCTURE_ID,
  TERM_ID,
} from "./fees-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
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

async function renderPage() {
  renderWithProviders(
    <>
      <UserLoaded />
      <StructurePage structureId={STRUCTURE_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

const button = (name: string) => screen.queryByRole("button", { name });

describe("fee structure page", () => {
  beforeEach(() => {
    stubFeesServices(`/fees/structures/${STRUCTURE_ID}`);
  });

  it("shows the schedules with the amount formatted and the due rule spelled out", async () => {
    asUser("fees.fee-structure.view", "school.academic-session.view");
    fetchFeeStructure.mockResolvedValue(
      structureRecord({
        status: "active",
        schedules: [
          scheduleRecord(),
          scheduleRecord({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            amount: "25000.5",
            frequency: "per_term",
            term: TERM_ID,
            due_day: null,
          }),
        ],
      }),
    );
    await renderPage();

    const table = await screen.findByRole("table", { name: "Fee schedules of this structure" });
    const monthly = within(table).getByText("Day 10 of each month").closest("tr");
    expect(monthly).not.toBeNull();
    expect(within(monthly as HTMLElement).getByText("1,500.00")).toBeInTheDocument();
    expect(within(monthly as HTMLElement).getByText("LIB Library fee")).toBeInTheDocument();
    expect(within(table).getByText("In Term 1")).toBeInTheDocument();
    expect(within(table).getByText("25,000.50")).toBeInTheDocument();
  });

  it("offers no action to a viewer holding only the view key", async () => {
    asUser("fees.fee-structure.view");
    await renderPage();

    await screen.findByText("Grade 1 fees");
    for (const name of ["Activate", "Archive", "Edit", "Delete", "Add schedule"]) {
      expect(button(name)).not.toBeInTheDocument();
    }
  });

  it("offers Activate, Edit, Delete and Add schedule on a draft to a holder of every key", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    await renderPage();

    expect(await screen.findByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(button("Edit")).toBeInTheDocument();
    expect(button("Delete")).toBeInTheDocument();
    expect(button("Add schedule")).toBeInTheDocument();
    expect(button("Archive")).not.toBeInTheDocument();
  });

  it("offers only Archive on an active structure, and fixes its schedules", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    fetchFeeStructure.mockResolvedValue(
      structureRecord({ status: "active", schedules: [scheduleRecord()] }),
    );
    await renderPage();

    expect(await screen.findByRole("button", { name: "Archive" })).toBeInTheDocument();
    for (const name of ["Activate", "Edit", "Delete", "Add schedule"]) {
      expect(button(name)).not.toBeInTheDocument();
    }
    expect(button("Edit the schedule for LIB Library fee")).not.toBeInTheDocument();
    expect(screen.getByText(/so its fees are fixed/)).toBeInTheDocument();
  });

  it("offers no lifecycle action on an archived structure", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    fetchFeeStructure.mockResolvedValue(structureRecord({ status: "archived" }));
    await renderPage();

    await screen.findByText("Grade 1 fees");
    for (const name of ["Activate", "Archive", "Edit", "Delete", "Add schedule"]) {
      expect(button(name)).not.toBeInTheDocument();
    }
  });

  it("shows the server's no-schedules refusal on Activate inline, and keeps the dialog open", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    activateFeeStructure.mockRejectedValue(
      ruleViolation("status", "This structure has no fee schedules, so it would charge nothing."),
    );
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Activate" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate" }));

    expect(
      await within(dialog).findByText(
        "This structure has no fee schedules, so it would charge nothing.",
      ),
    ).toBeInTheDocument();
    expect(activateFeeStructure).toHaveBeenCalledWith(STRUCTURE_ID);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows the scope-conflict refusal on Activate inline", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    activateFeeStructure.mockRejectedValue(
      ruleViolation(
        "status",
        "'Grade 1 fees (2025)' is already the active structure for this session, class and campus. Archive it first.",
      ),
    );
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Activate" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate" }));

    expect(await within(dialog).findByText(/is already the active structure/)).toBeInTheDocument();
  });

  it("archives an active structure", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    fetchFeeStructure.mockResolvedValue(
      structureRecord({ status: "active", schedules: [scheduleRecord()] }),
    );
    archiveFeeStructure.mockResolvedValue(structureRecord({ status: "archived" }));
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveFeeStructure).toHaveBeenCalledWith(STRUCTURE_ID);
    });
  });

  it("adds a schedule sending only the due rule its frequency uses", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    createFeeSchedule.mockResolvedValue(scheduleRecord());
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Add schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a fee schedule" });
    await user.click(await within(dialog).findByRole("combobox", { name: "Fee head" }));
    await user.click(await screen.findByRole("option", { name: "LIB Library fee" }));
    await user.type(within(dialog).getByLabelText("Amount"), "1500");
    await user.click(within(dialog).getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Monthly" }));
    await user.type(within(dialog).getByLabelText("Due day of the month"), "10");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createFeeSchedule).toHaveBeenCalledWith({
        feeStructureId: STRUCTURE_ID,
        feeHeadId: HEAD_ID,
        amount: "1500",
        frequency: "monthly",
        termId: null,
        dueDay: 10,
        dueDate: null,
      });
    });
  });

  it("shows the server's due-rule error under the field it names", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    createFeeSchedule.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "A monthly schedule needs a day-of-month due rule.",
        url: "/fee-schedules",
        details: [{ field: "due_day", issue: "A monthly schedule needs a day-of-month due rule." }],
      }),
    );
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Add schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a fee schedule" });
    await user.click(await within(dialog).findByRole("combobox", { name: "Fee head" }));
    await user.click(await screen.findByRole("option", { name: "LIB Library fee" }));
    await user.type(within(dialog).getByLabelText("Amount"), "1500");
    await user.click(within(dialog).getByRole("combobox", { name: "Frequency" }));
    await user.click(await screen.findByRole("option", { name: "Monthly" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // The message is the field's accessible description (`aria-describedby` on the input).
    const dueDay = within(dialog).getByLabelText("Due day of the month");
    await waitFor(() => {
      expect(dueDay).toHaveAccessibleDescription(
        "A monthly schedule needs a day-of-month due rule.",
      );
    });
  });

  it("shows the server's frequency error under the frequency field", async () => {
    asUser(...FEES_SETUP_AUTHOR_PERMISSIONS);
    createFeeSchedule.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: '"x" is not a valid choice.',
        url: "/fee-schedules",
        details: [{ field: "frequency", issue: '"x" is not a valid choice.' }],
      }),
    );
    const user = await renderPage();

    await user.click(await screen.findByRole("button", { name: "Add schedule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a fee schedule" });
    await user.click(await within(dialog).findByRole("combobox", { name: "Fee head" }));
    await user.click(await screen.findByRole("option", { name: "LIB Library fee" }));
    await user.type(within(dialog).getByLabelText("Amount"), "1500");
    await user.type(within(dialog).getByLabelText("Due date"), "2026-12-01");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText('"x" is not a valid choice.')).toBeInTheDocument();
  });

  it("says so when the structure does not exist", async () => {
    asUser("fees.fee-structure.view");
    fetchFeeStructure.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "not_found",
        message: "Not found.",
        url: "/fee-structures",
      }),
    );
    await renderPage();

    expect(await screen.findByText("Fee structure not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to structures" })).toHaveAttribute(
      "href",
      "/fees/structures",
    );
  });
});
