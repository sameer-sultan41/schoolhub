import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  ATTACHMENT_FILE_ID,
  leaveRecord,
  leaveType,
  SICK_TYPE_ID,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";
import { mocked, pick } from "@/test-fixtures/list-screen";
import { AYESHA_ID, portalDashboard } from "@/test-fixtures/portal";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders } from "@/test-utils";

import { PortalLeave } from "../portal-leave";

const mockUseParams = jest.fn();

jest.mock("next/navigation", () => ({
  useParams: () => mockUseParams() as unknown,
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({
      auth: ["fetchCurrentUser"],
      parentPortal: ["fetchPortalDashboard"],
      leaveRequests: ["fetchLeavePage", "fetchLeaveTypes", "createLeave", "cancelLeave"],
      files: ["uploadFile"],
    }),
);

const CASUAL_TYPE_ID = "66666666-aaaa-4bbb-8ccc-0000000000c2";
const STAFF_TYPE_ID = "66666666-aaaa-4bbb-8ccc-0000000000c3";
const TYPES = [
  leaveType({ id: SICK_TYPE_ID, name: "Sick leave", requires_attachment: true }),
  leaveType({ id: CASUAL_TYPE_ID, name: "Family event", requires_attachment: false }),
  leaveType({ id: STAFF_TYPE_ID, name: "Staff only", applies_to: "staff" }),
];

const listPage = (items = [leaveRecord()]) => ({ items });

async function renderLeave() {
  renderWithProviders(
    <>
      <UserLoaded />
      <PortalLeave />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

function fillDates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("From"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: to } });
}

describe("PortalLeave", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ studentId: AYESHA_ID });
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["attendance.leave-request.view", "attendance.leave-request.create"]),
    );
    mocked(Services.parentPortal.fetchPortalDashboard).mockResolvedValue(portalDashboard());
    mocked(Services.leaveRequests.fetchLeavePage).mockResolvedValue(listPage());
    mocked(Services.leaveRequests.fetchLeaveTypes).mockResolvedValue(TYPES);
    mocked(Services.leaveRequests.createLeave).mockReset();
    mocked(Services.leaveRequests.cancelLeave).mockReset();
    mocked(Services.files.uploadFile).mockReset();
  });

  it("lists the child's requests, asking the server for that child only", async () => {
    await renderLeave();

    expect(await screen.findByText("Sick leave")).toBeInTheDocument();
    expect(screen.getByText("Fever, and a visit to the doctor")).toBeInTheDocument();
    expect(Services.leaveRequests.fetchLeavePage).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: AYESHA_ID }),
    );
  });

  it("offers Cancel on a pending request only, and withdraws it once confirmed", async () => {
    mocked(Services.leaveRequests.fetchLeavePage).mockResolvedValue(
      listPage([leaveRecord(), leaveRecord({ id: "other", status: "approved" })]),
    );
    mocked(Services.leaveRequests.cancelLeave).mockResolvedValue(
      leaveRecord({ status: "cancelled" }),
    );
    const user = await renderLeave();

    const cancel = await screen.findAllByRole("button", { name: "Cancel request" });
    expect(cancel).toHaveLength(1);
    await user.click(cancel[0] as HTMLElement);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel request",
      }),
    );

    await waitFor(() => {
      expect(Services.leaveRequests.cancelLeave).toHaveBeenCalledWith(leaveRecord().id);
    });
  });

  it("shows the server's refusal inline and keeps the cancel dialog open", async () => {
    mocked(Services.leaveRequests.cancelLeave).mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Leave can only be cancelled before it starts (§6).",
        status: 422,
        url: "/leave-requests",
        details: [
          { field: "start_date", issue: "Leave can only be cancelled before it starts (§6)." },
        ],
      }),
    );
    const user = await renderLeave();

    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Cancel request",
      }),
    );

    expect(await screen.findByText(/only be cancelled before it starts/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("says there is nothing yet when the child has no requests", async () => {
    mocked(Services.leaveRequests.fetchLeavePage).mockResolvedValue(listPage([]));

    await renderLeave();

    expect(await screen.findByText("No leave requests")).toBeInTheDocument();
  });

  it("lists only the active leave types a student may use", async () => {
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: "New request" }));

    await user.click(await screen.findByRole("combobox", { name: "Leave type" }));

    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Sick leave",
      "Family event",
    ]);
  });

  it("requires an attachment when the type asks for one, then sends the uploaded file's id", async () => {
    mocked(Services.files.uploadFile).mockResolvedValue(ATTACHMENT_FILE_ID);
    mocked(Services.leaveRequests.createLeave).mockResolvedValue(leaveRecord());
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: "New request" }));
    await pick(user, "Leave type", "Sick leave");
    fillDates("2026-11-10", "2026-11-11");
    await user.type(screen.getByLabelText("Reason"), "Fever");

    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(
      await screen.findByText("This leave type needs a supporting document."),
    ).toBeInTheDocument();
    expect(Services.leaveRequests.createLeave).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText("Supporting document (PDF, JPEG or PNG)"),
      new File(["x"], "note.pdf", { type: "application/pdf" }),
    );
    await screen.findByText("note.pdf");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(Services.leaveRequests.createLeave).toHaveBeenCalledWith({
        studentId: AYESHA_ID,
        leaveTypeId: SICK_TYPE_ID,
        startDate: "2026-11-10",
        endDate: "2026-11-11",
        dayPart: "full",
        reason: "Fever",
        attachmentFileId: ATTACHMENT_FILE_ID,
      });
    });
    expect(Services.files.uploadFile).toHaveBeenCalledWith(
      expect.any(File),
      "attendance.leave-attachment",
    );
  });

  it("asks for no attachment when the type needs none", async () => {
    mocked(Services.leaveRequests.createLeave).mockResolvedValue(leaveRecord());
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: "New request" }));
    await pick(user, "Leave type", "Family event");
    fillDates("2026-11-10", "2026-11-10");
    await user.type(screen.getByLabelText("Reason"), "Wedding");

    expect(screen.queryByLabelText(/Supporting document/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(Services.leaveRequests.createLeave).toHaveBeenCalledWith(
        expect.objectContaining({ leaveTypeId: CASUAL_TYPE_ID, attachmentFileId: undefined }),
      );
    });
  });

  it("refuses a half day over several dates before asking the server", async () => {
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: "New request" }));
    await pick(user, "Leave type", "Family event");
    await pick(user, "Day part", "First half");
    fillDates("2026-11-10", "2026-11-12");
    await user.type(screen.getByLabelText("Reason"), "Wedding");

    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("A half day can only cover a single date.")).toBeInTheDocument();
    expect(Services.leaveRequests.createLeave).not.toHaveBeenCalled();
  });

  it("shows the server's 422 under the attachment field", async () => {
    mocked(Services.files.uploadFile).mockResolvedValue(ATTACHMENT_FILE_ID);
    mocked(Services.leaveRequests.createLeave).mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid input.",
        status: 422,
        url: "/leave-requests",
        details: [{ field: "attachment_file_id", issue: "That file was not uploaded by you." }],
      }),
    );
    const user = await renderLeave();
    await user.click(await screen.findByRole("button", { name: "New request" }));
    await pick(user, "Leave type", "Sick leave");
    fillDates("2026-11-10", "2026-11-10");
    await user.type(screen.getByLabelText("Reason"), "Fever");
    await user.upload(
      screen.getByLabelText("Supporting document (PDF, JPEG or PNG)"),
      new File(["x"], "note.pdf", { type: "application/pdf" }),
    );
    await screen.findByText("note.pdf");

    await user.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("That file was not uploaded by you.")).toBeInTheDocument();
    // Tied to the input itself, so a message that fell through to the form alert fails this.
    expect(
      screen.getByLabelText("Supporting document (PDF, JPEG or PNG)"),
    ).toHaveAccessibleDescription("That file was not uploaded by you.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides New request from a viewer without the create key", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["attendance.leave-request.view"]),
    );

    await renderLeave();

    await screen.findByText("Sick leave");
    expect(screen.queryByRole("button", { name: "New request" })).not.toBeInTheDocument();
  });
});
