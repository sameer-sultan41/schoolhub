import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  CLOSED_SESSION,
  CLOSED_SESSION_ID,
  PLANNED_SESSION,
  SESSION_ID,
  SESSIONS,
} from "@/test-fixtures/academics";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders } from "@/test-utils";

import { ImportAttendanceButton } from "../import-attendance-button";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({
      auth: ["fetchCurrentUser"],
      schoolOrganization: ["fetchAcademicSessions"],
      studentAttendance: ["triggerAttendanceImport"],
      jobs: ["fetchJob"],
    }),
);

const IMPORT: PermissionKey = "attendance.student-attendance.import";
const VIEW: PermissionKey = "attendance.student-attendance.view";
const triggerImport = mocked(Services.studentAttendance.triggerAttendanceImport);

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW, ...keys]));
}

async function renderButton() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ImportAttendanceButton />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

function historyFile() {
  return new File(["admission_number,attendance_date,status"], "history.csv", {
    type: "text/csv",
  });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", { name: "Import" });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await user.click(button);
  return screen.findByRole("dialog", { name: "Import attendance history" });
}

describe("ImportAttendanceButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mocked(Services.schoolOrganization.fetchAcademicSessions).mockResolvedValue(SESSIONS);
    triggerImport.mockResolvedValue({ jobId: "job-1" });
    mocked(Services.jobs.fetchJob).mockReturnValue(new Promise(() => {}));
  });

  it("is not offered to a viewer without the import key", async () => {
    asUser();
    await renderButton();

    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    // Nothing is read for a viewer who can't import: the sessions list is behind the key.
    expect(Services.schoolOrganization.fetchAcademicSessions).not.toHaveBeenCalled();
  });

  it("shows the template's exact headers, required and optional", async () => {
    asUser(IMPORT);
    const user = await renderButton();

    const dialog = await openDialog(user);

    for (const column of [
      "admission_number",
      "attendance_date",
      "status",
      "check_in_time",
      "check_out_time",
      "remarks",
    ]) {
      expect(within(dialog).getByText(column)).toBeInTheDocument();
    }
  });

  it("imports into the current session unless another is picked", async () => {
    asUser(IMPORT);
    const user = await renderButton();

    await openDialog(user);
    const file = historyFile();
    await user.upload(screen.getByLabelText("File"), file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(triggerImport).toHaveBeenCalledWith(file, SESSION_ID);
    });
  });

  it("files the rows under the session picked in the dialog", async () => {
    asUser(IMPORT);
    const user = await renderButton();

    await openDialog(user);
    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: new RegExp(CLOSED_SESSION.name) }));
    const file = historyFile();
    await user.upload(screen.getByLabelText("File"), file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(triggerImport).toHaveBeenCalledWith(file, CLOSED_SESSION_ID);
    });
  });

  it("lets a school with no current session pick a past one, and waits for that pick", async () => {
    asUser(IMPORT);
    mocked(Services.schoolOrganization.fetchAcademicSessions).mockResolvedValue([
      PLANNED_SESSION,
      CLOSED_SESSION,
    ]);
    const user = await renderButton();

    await openDialog(user);
    const file = historyFile();
    await user.upload(screen.getByLabelText("File"), file);
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: new RegExp(CLOSED_SESSION.name) }));
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(triggerImport).toHaveBeenCalledWith(file, CLOSED_SESSION_ID);
    });
  });

  it("locks the session picker while the import runs", async () => {
    asUser(IMPORT);
    const user = await renderButton();

    await openDialog(user);
    expect(screen.getByRole("combobox", { name: "Academic session" })).toBeEnabled();
    await user.upload(screen.getByLabelText("File"), historyFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Academic session" })).toBeDisabled();
    });
  });

  it("can't be opened when the school has no session at all", async () => {
    asUser(IMPORT);
    mocked(Services.schoolOrganization.fetchAcademicSessions).mockResolvedValue([]);
    await renderButton();

    const button = await screen.findByRole("button", { name: "Import" });
    await waitFor(() => {
      expect(mocked(Services.schoolOrganization.fetchAcademicSessions)).toHaveBeenCalled();
    });
    expect(button).toBeDisabled();
  });
});
