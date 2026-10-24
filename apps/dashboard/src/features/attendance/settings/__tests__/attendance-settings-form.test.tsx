import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  attendanceSettings,
  TIMETABLE_REQUIRED_MESSAGE,
} from "@/services/modules/attendance-settings/__tests__/attendance-settings-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { AttendanceSettingsForm } from "../attendance-settings-form";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    attendanceSettings: { fetchSettings: jest.fn(), updateSettings: jest.fn() },
  },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const svc = Services;

function asUser(...keys: PermissionKey[]) {
  mocked(svc.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
}

/** The server's 422 for a refused switch: one detail, on the field it names. */
function timetableRequiredError() {
  return new ApiError({
    code: "domain_rule_violation",
    message: TIMETABLE_REQUIRED_MESSAGE,
    status: 422,
    url: "/attendance-settings",
    details: [{ field: "attendance_mode", issue: TIMETABLE_REQUIRED_MESSAGE }],
  });
}

const saveButton = () => screen.getByRole("button", { name: "Save" });
const lockWindow = () => screen.getByLabelText("Lock window (days)");
const threshold = () => screen.getByLabelText("Leave escalation threshold (days)");

/** Renders the screen once the settings and the viewer's permissions have both loaded: the
 * form is read-only until the viewer is known, so an edit must wait for the Save button. */
async function renderForm() {
  renderWithProviders(<AttendanceSettingsForm />);
  const user = userEvent.setup();
  await screen.findByRole("radiogroup", { name: "Attendance mode" });
  await screen.findByRole("button", { name: "Save" });
  return user;
}

describe("attendance settings form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/attendance/settings");
    asUser("school.settings.update");
    mocked(svc.attendanceSettings.fetchSettings).mockResolvedValue(attendanceSettings());
  });

  it("shows the current settings and says what a change does", async () => {
    await renderForm();

    expect(screen.getByRole("radio", { name: "Daily" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Period" })).not.toBeChecked();
    expect(lockWindow()).toHaveValue(2);
    expect(threshold()).toHaveValue(10);
    expect(
      screen.getByText("Switching modes doesn't change registers that are already marked."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Period mode needs the timetable module. While it is off, every period register is refused; switch back to daily to keep marking.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Raising the window doesn't reopen rows the nightly lock has already locked.",
      ),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("saves only the setting that changed, then refreshes and starts clean", async () => {
    const saved = attendanceSettings({ lock_window_days: 5 });
    mocked(svc.attendanceSettings.updateSettings).mockResolvedValue(saved);
    // The refresh after the save reads what the server now holds.
    mocked(svc.attendanceSettings.fetchSettings)
      .mockResolvedValueOnce(attendanceSettings())
      .mockResolvedValue(saved);
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = await renderForm();

    await user.clear(lockWindow());
    await user.type(lockWindow(), "5");
    await user.click(saveButton());

    await waitFor(() => {
      expect(svc.attendanceSettings.updateSettings).toHaveBeenCalledWith({ lockWindowDays: 5 });
    });
    expect(toast.success).toHaveBeenCalledWith("Attendance settings saved.");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attendance-settings"] });
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
    expect(lockWindow()).toHaveValue(5);
    invalidate.mockRestore();
  });

  it("switches to period mode, sends the mode alone and stales every register read", async () => {
    mocked(svc.attendanceSettings.updateSettings).mockResolvedValue(
      attendanceSettings({ attendance_mode: "period" }),
    );
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = await renderForm();

    await user.click(screen.getByRole("radio", { name: "Period" }));
    await user.click(saveButton());

    await waitFor(() => {
      expect(svc.attendanceSettings.updateSettings).toHaveBeenCalledWith({
        attendanceMode: "period",
      });
    });
    // The register and My registers were read under the old mode.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["student-attendance"] });
    });
    invalidate.mockRestore();
  });

  it("leaves an unchanged period mode out of an unrelated save", async () => {
    mocked(svc.attendanceSettings.fetchSettings).mockResolvedValue(
      attendanceSettings({ attendance_mode: "period" }),
    );
    mocked(svc.attendanceSettings.updateSettings).mockResolvedValue(
      attendanceSettings({ attendance_mode: "period", leave_escalation_threshold_days: 14 }),
    );
    const user = await renderForm();

    await user.clear(threshold());
    await user.type(threshold(), "14");
    await user.click(saveButton());

    await waitFor(() => {
      expect(svc.attendanceSettings.updateSettings).toHaveBeenCalledWith({
        leaveEscalationThresholdDays: 14,
      });
    });
  });

  it("puts the timetable-off refusal under the mode, keeping the choice and notes", async () => {
    mocked(svc.attendanceSettings.updateSettings).mockRejectedValue(timetableRequiredError());
    const user = await renderForm();

    await user.click(screen.getByRole("radio", { name: "Period" }));
    await user.click(saveButton());

    expect(await screen.findByText(TIMETABLE_REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.getAllByText(TIMETABLE_REQUIRED_MESSAGE)).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Period" })).toBeChecked();
    expect(
      screen.getByText("Switching modes doesn't change registers that are already marked."),
    ).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses a lock window above 7 before any request", async () => {
    const user = await renderForm();

    await user.clear(lockWindow());
    await user.type(lockWindow(), "8");
    await user.click(saveButton());

    expect(await screen.findByText("Enter a whole number from 0 to 7.")).toBeInTheDocument();
    expect(svc.attendanceSettings.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses an escalation threshold of zero before any request", async () => {
    const user = await renderForm();

    await user.clear(threshold());
    await user.type(threshold(), "0");
    await user.click(saveButton());

    expect(await screen.findByText("Enter a whole number of 1 or more.")).toBeInTheDocument();
    expect(svc.attendanceSettings.updateSettings).not.toHaveBeenCalled();
  });

  it("shows a refusal that names no field as the form's own message", async () => {
    mocked(svc.attendanceSettings.updateSettings).mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        status: 403,
        url: "/attendance-settings",
      }),
    );
    const user = await renderForm();

    await user.clear(lockWindow());
    await user.type(lockWindow(), "3");
    await user.click(saveButton());

    expect(await screen.findByText("You do not have permission to do that.")).toBeInTheDocument();
  });

  it("shows a viewer without the update key the settings read-only", async () => {
    asUser("school.settings.view");
    renderWithProviders(<AttendanceSettingsForm />);

    expect(
      await screen.findByText("You can view these settings but not change them."),
    ).toBeInTheDocument();
    expect(lockWindow()).toBeDisabled();
    expect(threshold()).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Daily" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("offers a retry when the settings fail to load", async () => {
    mocked(svc.attendanceSettings.fetchSettings).mockRejectedValueOnce(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/attendance-settings",
      }),
    );
    renderWithProviders(<AttendanceSettingsForm />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("radiogroup", { name: "Attendance mode" })).toBeInTheDocument();
    expect(svc.attendanceSettings.fetchSettings).toHaveBeenCalledTimes(2);
  });
});
