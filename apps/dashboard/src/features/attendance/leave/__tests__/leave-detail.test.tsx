import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import {
  ATTACHMENT_FILE_ID,
  cancelledEscalatedRecord,
  decidedStep,
  leavePage,
  leaveRecord,
  OTHER_APPROVER_ID,
  rejectedEscalatedRecord,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";
import { mocked } from "@/test-fixtures/list-screen";

import {
  amnaPending,
  asUser,
  fetchDownloadUrl,
  fetchPage,
  renderLeave,
  stubLeaveServices,
} from "./leave-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ leaveServicesMock: () => unknown }>("./leave-services-mock")
    .leaveServicesMock(),
);

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

const SIGNED_URL = "https://files.example.test/signed/medical-note.pdf";

/** Queries within the chain step for `level`. */
function stepOf(sheet: HTMLElement, level: number) {
  const item = within(sheet).getByText(`Level ${level}`).closest("li");
  if (!item) throw new Error(`no step for level ${level}`);
  return within(item);
}

/** Opens the detail sheet of the request whose student is `name`. */
async function openDetail(user: Awaited<ReturnType<typeof renderLeave>>, name: string) {
  await user.click(await screen.findByText(name));
  return screen.findByRole("dialog", { name: `Leave request for ${name}` });
}

describe("LeaveDetailSheet", () => {
  beforeEach(stubLeaveServices);

  it("shows who, when and why, from the request the list already holds", async () => {
    const user = await renderLeave();

    const sheet = await openDetail(user, "Amna Raza");

    expect(within(sheet).getByText("Admission number ADM-1042")).toBeInTheDocument();
    // Pending twice: the request's status, and its one step still waiting.
    expect(within(sheet).getAllByText("Pending")).toHaveLength(2);
    expect(within(sheet).getByText("Grade 5 A")).toBeInTheDocument();
    expect(within(sheet).getByText("Sick leave")).toBeInTheDocument();
    expect(within(sheet).getByText("October 26th, 2026 to October 28th, 2026")).toBeInTheDocument();
    expect(within(sheet).getByText("Full day")).toBeInTheDocument();
    expect(within(sheet).getByText("3")).toBeInTheDocument();
    expect(within(sheet).getByText("Usman Raza")).toBeInTheDocument();
    expect(within(sheet).getByText("Fever, and a visit to the doctor")).toBeInTheDocument();
    // The list's own record: opening the sheet reads nothing more.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("lays out the approval chain: each level's key, approver, decision and note", async () => {
    const user = await renderLeave();

    const sheet = await openDetail(user, "Noor Qureshi");

    expect(within(sheet).getAllByRole("listitem")).toHaveLength(2);
    const first = stepOf(sheet, 1);
    expect(first.getByText("Needs attendance.leave-request.approve")).toBeInTheDocument();
    expect(first.getByText("Approved")).toBeInTheDocument();
    expect(first.getByText("Zainab Qureshi")).toBeInTheDocument();
    expect(first.getByText("Decided on October 23rd, 2026")).toBeInTheDocument();
    expect(first.getByText("Seen the medical note")).toBeInTheDocument();
    const second = stepOf(sheet, 2);
    expect(second.getByText("Pending")).toBeInTheDocument();
    expect(second.getByText("Waiting for a decision")).toBeInTheDocument();
  });

  it("shows a rejected step and the note that came with it", async () => {
    fetchPage.mockResolvedValue(
      leavePage([
        leaveRecord({
          status: "rejected",
          approvals: [
            decidedStep({
              approver_id: OTHER_APPROVER_ID,
              decision: "rejected",
              note: "Not covered by this leave type",
            }),
          ],
        }),
      ]),
    );
    const user = await renderLeave();

    const sheet = await openDetail(user, "Amna Raza");

    const step = stepOf(sheet, 1);
    expect(step.getByText("Rejected")).toBeInTheDocument();
    expect(step.getByText("Not covered by this leave type")).toBeInTheDocument();
  });

  it("calls the unreached level 2 of a rejected request Not reached, never Waiting", async () => {
    fetchPage.mockResolvedValue(leavePage([rejectedEscalatedRecord()]));
    const user = await renderLeave();

    const sheet = await openDetail(user, "Amna Raza");

    const first = stepOf(sheet, 1);
    expect(first.getByText("Rejected")).toBeInTheDocument();
    expect(first.getByText("Not covered by this leave type")).toBeInTheDocument();
    const second = stepOf(sheet, 2);
    expect(second.getByText("Not reached")).toBeInTheDocument();
    expect(second.queryByText("Pending")).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Waiting for a decision")).not.toBeInTheDocument();
  });

  it("calls every step of a cancelled request Not reached", async () => {
    fetchPage.mockResolvedValue(leavePage([cancelledEscalatedRecord()]));
    const user = await renderLeave();

    const sheet = await openDetail(user, "Amna Raza");

    expect(within(sheet).getAllByText("Not reached")).toHaveLength(2);
    expect(within(sheet).queryByText("Waiting for a decision")).not.toBeInTheDocument();
    // The request's own badge is the one "Cancelled"; no step reads Pending.
    expect(within(sheet).getByText("Cancelled")).toBeInTheDocument();
    expect(within(sheet).queryByText("Pending")).not.toBeInTheDocument();
  });

  it("opens from the keyboard and closes again", async () => {
    const user = await renderLeave();
    const row = (await screen.findByText("Amna Raza")).closest("tr");
    if (!row) throw new Error("no row for Amna Raza");

    row.focus();
    await user.keyboard("{Enter}");
    const sheet = await screen.findByRole("dialog", { name: "Leave request for Amna Raza" });
    await user.click(within(sheet).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("opens the decision, not the detail, when Approve is clicked", async () => {
    asUser("attendance.leave-request.approve");
    const user = await renderLeave();

    await user.click(
      await screen.findByRole("button", { name: "Approve the leave request for Amna Raza" }),
    );

    expect(await screen.findByRole("dialog", { name: "Approve leave request" })).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Leave request for Amna Raza" }),
    ).not.toBeInTheDocument();
  });

  describe("attachment", () => {
    const withFile = leaveRecord({ attachment_file_id: ATTACHMENT_FILE_ID });

    beforeEach(() => {
      fetchPage.mockResolvedValue(leavePage([withFile]));
    });

    it("says so when there is none, and offers no download", async () => {
      fetchPage.mockResolvedValue(leavePage([amnaPending]));
      asUser("platform.file.view");
      const user = await renderLeave();

      const sheet = await openDetail(user, "Amna Raza");

      expect(within(sheet).getByText("No attachment.")).toBeInTheDocument();
      expect(
        within(sheet).queryByRole("button", { name: "Download attachment" }),
      ).not.toBeInTheDocument();
    });

    it("downloads through a fresh signed URL for the attached file", async () => {
      asUser("platform.file.view");
      fetchDownloadUrl.mockResolvedValue(SIGNED_URL);
      const user = await renderLeave();
      const sheet = await openDetail(user, "Amna Raza");

      await user.click(within(sheet).getByRole("button", { name: "Download attachment" }));

      await waitFor(() => {
        expect(fetchDownloadUrl).toHaveBeenCalledWith(ATTACHMENT_FILE_ID);
      });
      await waitFor(() => {
        expect(mocked(downloadFile)).toHaveBeenCalledWith(SIGNED_URL);
      });
    });

    it("toasts the server's reason when the download link cannot be made", async () => {
      asUser("platform.file.view");
      fetchDownloadUrl.mockRejectedValue(
        new ApiError({
          code: "not_found",
          message: "Not found.",
          status: 404,
          url: `/files/${ATTACHMENT_FILE_ID}:download`,
        }),
      );
      const user = await renderLeave();
      const sheet = await openDetail(user, "Amna Raza");

      await user.click(within(sheet).getByRole("button", { name: "Download attachment" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("We could not find what you were looking for.");
      });
      expect(mocked(downloadFile)).not.toHaveBeenCalled();
    });

    it("shows the file as attached, with no download, without platform.file.view", async () => {
      const user = await renderLeave();

      const sheet = await openDetail(user, "Amna Raza");

      expect(within(sheet).getByText("A file is attached.")).toBeInTheDocument();
      expect(
        within(sheet).queryByRole("button", { name: "Download attachment" }),
      ).not.toBeInTheDocument();
    });
  });
});
