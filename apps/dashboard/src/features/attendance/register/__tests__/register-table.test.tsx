import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";

import { Services, type RegisterEntry, type RegisterResult } from "@/services";
import {
  attendanceRecord,
  ISSUE_ON_LEAVE,
  ISSUE_NOT_ENROLLED,
  ON_LEAVE_REFUSED_MESSAGE,
  onLeaveBulkMark,
  OTHER_STUDENT_ID,
  REFUSED_MESSAGE,
  refusedBulkMark,
  registerEntry,
  registerMetaWire,
  SECTION_ID,
  SESSION_ID,
  STUDENT_ID,
  THIRD_STUDENT_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { toRegisterMeta } from "@/services/modules/student-attendance/student-attendance-helper";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders } from "@/test-utils";

import { RegisterTable } from "../register-table";

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
    studentAttendance: { fetchRegister: jest.fn(), bulkMark: jest.fn() },
    attendanceCorrections: { requestCorrection: jest.fn() },
  },
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;
const svc = Services;
const DATE = "2026-10-23";
/** The server's 409 for a submission that touches a locked row (`bulk_mark_student_attendance`). */
const LOCKED_MESSAGE =
  "Some of these records are locked and must be changed through a correction request.";
const SAVED = { marked: 1, updated: 0, alertsQueued: 0 };
/** `BulkMarkEntrySerializer.validate`'s refusal of a check-out not after the check-in. */
const LEAVES_EARLY = "A student cannot leave before they arrived.";

const bilal = (overrides: Partial<RegisterEntry> = {}) =>
  registerEntry({
    student_id: OTHER_STUDENT_ID,
    student_name: "Bilal Khan",
    admission_number: "ADM-002",
    roll_number: "2",
    ...overrides,
  });
const sara = (overrides: Partial<RegisterEntry> = {}) =>
  registerEntry({
    student_id: THIRD_STUDENT_ID,
    student_name: "Sara Ali",
    admission_number: "ADM-003",
    roll_number: "3",
    ...overrides,
  });

function registerOf(entries: RegisterEntry[], meta: Record<string, unknown> = {}): RegisterResult {
  return { entries, meta: toRegisterMeta(registerMetaWire(meta)) };
}

function asUser(...keys: PermissionKey[]) {
  mocked(svc.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["attendance.student-attendance.mark", ...keys]),
  );
}

function renderRegister() {
  renderWithProviders(
    <>
      <UserLoaded />
      <RegisterTable sectionId={SECTION_ID} date={DATE} periodId="" />
    </>,
  );
  return userEvent.setup();
}

const statusOf = (name: string) => screen.getByRole("radiogroup", { name: `Status for ${name}` });
const radio = (name: string, status: string) =>
  within(statusOf(name)).getByRole("radio", { name: status });
async function mark(user: UserEvent, name: string, status: string) {
  await user.click(radio(name, status));
}
const submitButton = () => screen.getByRole("button", { name: "Submit" });
const keyOfCall = (index: number) => mocked(svc.studentAttendance.bulkMark).mock.calls[index]?.[1];

describe("RegisterTable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asUser();
  });

  it("shows each student by roll, name and admission number, in the server's order", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([registerEntry(), bilal()]),
    );
    renderRegister();

    const rows = within(await screen.findByRole("list", { name: "Students" })).getAllByRole(
      "listitem",
    );
    expect(rows[0]).toHaveTextContent("Roll 1 Amna Raza");
    expect(rows[0]).toHaveTextContent("ADM-001");
    expect(rows[1]).toHaveTextContent("Bilal Khan");
    expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledWith({
      sectionId: SECTION_ID,
      date: DATE,
      periodId: undefined,
    });
  });

  it("marks all present but the student on leave, and sends only the rows it may", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([registerEntry(), bilal({ on_leave: true }), sara()]),
    );
    mocked(svc.studentAttendance.bulkMark).mockResolvedValue({ records: [], meta: SAVED });
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText("2 students still to mark")).toBeInTheDocument();
    // Leave is shown, read-only.
    expect(
      screen.queryByRole("radiogroup", { name: "Status for Bilal Khan" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("On leave").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Mark all present" }));
    expect(radio("Amna Raza", "Present")).toBeChecked();
    expect(radio("Sara Ali", "Present")).toBeChecked();
    await mark(user, "Sara Ali", "Late");
    expect(screen.getByLabelText("Check-in time for Sara Ali")).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.click(submitButton());

    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(1);
    });
    expect(mocked(svc.studentAttendance.bulkMark).mock.calls[0]?.[0]).toEqual({
      sectionId: SECTION_ID,
      attendanceDate: DATE,
      periodId: null,
      academicSessionId: SESSION_ID,
      entries: [
        expect.objectContaining({ studentId: STUDENT_ID, status: "present" }),
        expect.objectContaining({ studentId: THIRD_STUDENT_ID, status: "late" }),
      ],
    });
  });

  it("toasts the server's counts, refreshes the module and makes a new key", async () => {
    const marked = registerOf([registerEntry({ record: attendanceRecord({ status: "absent" }) })]);
    mocked(svc.studentAttendance.fetchRegister)
      .mockResolvedValueOnce(registerOf([registerEntry()]))
      .mockResolvedValue(marked);
    mocked(svc.studentAttendance.bulkMark).mockResolvedValue({
      records: [attendanceRecord({ status: "absent" })],
      meta: { marked: 1, updated: 0, alertsQueued: 1 },
    });
    const invalidate = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Absent");
    await user.click(submitButton());

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Register saved: 1 marked, 0 updated, 1 guardian alert queued.",
      );
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["student-attendance"] });
    // The saved row is shown at once, and a second submit is not a replay of the first.
    expect(radio("Amna Raza", "Absent")).toBeChecked();
    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    await user.click(submitButton());
    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(2);
    });
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
    invalidate.mockRestore();
  });

  it("retries a dropped submission under the same key, and an edit makes a new one", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(registerOf([registerEntry()]));
    mocked(svc.studentAttendance.bulkMark).mockRejectedValue(
      new ApiError({
        code: "network_error",
        message: "Network request failed",
        status: 0,
        url: "/student-attendance:bulk-mark",
      }),
    );
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Present");
    await user.click(submitButton());
    await screen.findByRole("alert");
    await user.click(submitButton());
    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(2);
    });
    // Nothing changed: the retry may be answered with the first attempt's replay.
    expect(keyOfCall(1)).toBe(keyOfCall(0));

    await mark(user, "Amna Raza", "Absent");
    await user.click(submitButton());
    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(3);
    });
    expect(keyOfCall(2)).not.toBe(keyOfCall(1));
  });

  it("marks the refused rows with the server's issue and keeps every other choice", async () => {
    mocked(svc.studentAttendance.fetchRegister)
      .mockResolvedValueOnce(registerOf([registerEntry(), bilal(), sara()]))
      // Leave approved since the register loaded: the reload shows it.
      .mockResolvedValue(registerOf([registerEntry(), bilal({ on_leave: true }), sara()]));
    mocked(svc.studentAttendance.bulkMark)
      .mockRejectedValueOnce(onLeaveBulkMark([OTHER_STUDENT_ID]))
      .mockResolvedValue({ records: [], meta: SAVED });
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Absent");
    await mark(user, "Bilal Khan", "Absent");
    await mark(user, "Sara Ali", "Late");
    await user.click(submitButton());

    expect(await screen.findByText(ISSUE_ON_LEAVE)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(ON_LEAVE_REFUSED_MESSAGE);
    await waitFor(() => {
      expect(svc.studentAttendance.fetchRegister).toHaveBeenCalledTimes(2);
    });
    expect(radio("Amna Raza", "Absent")).toBeChecked();
    expect(radio("Sara Ali", "Late")).toBeChecked();
    await waitFor(() => {
      expect(
        screen.queryByRole("radiogroup", { name: "Status for Bilal Khan" }),
      ).not.toBeInTheDocument();
    });

    await user.click(submitButton());
    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(2);
    });
    const resent = mocked(svc.studentAttendance.bulkMark).mock.calls[1]?.[0];
    expect(resent?.entries.map((entry) => entry.studentId)).toEqual([STUDENT_ID, THIRD_STUDENT_ID]);
  });

  it("drops a student who left the section once the refusal reloads the register", async () => {
    mocked(svc.studentAttendance.fetchRegister)
      .mockResolvedValueOnce(registerOf([registerEntry(), bilal()]))
      .mockResolvedValue(registerOf([registerEntry()]));
    mocked(svc.studentAttendance.bulkMark)
      .mockRejectedValueOnce(
        refusedBulkMark([{ student_id: OTHER_STUDENT_ID, issue: ISSUE_NOT_ENROLLED }]),
      )
      .mockResolvedValue({ records: [], meta: SAVED });
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Absent");
    await mark(user, "Bilal Khan", "Present");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSED_MESSAGE);
    await waitFor(() => {
      expect(screen.queryByText("Bilal Khan")).not.toBeInTheDocument();
    });
    expect(radio("Amna Raza", "Absent")).toBeChecked();

    await user.click(submitButton());
    await waitFor(() => {
      expect(svc.studentAttendance.bulkMark).toHaveBeenCalledTimes(2);
    });
    const resent = mocked(svc.studentAttendance.bulkMark).mock.calls[1]?.[0];
    expect(resent?.entries.map((entry) => entry.studentId)).toEqual([STUDENT_ID]);
  });

  it("shows a refusal on the register's own fields inline, in the server's words", async () => {
    const issue = "This school takes attendance per period; name the period.";
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(registerOf([registerEntry()]));
    mocked(svc.studentAttendance.bulkMark).mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/student-attendance:bulk-mark",
        details: [{ field: "period_id", issue }],
      }),
    );
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Present");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
    expect(radio("Amna Raza", "Present")).toBeChecked();
  });

  it("holds Submit while a check-out isn't after the check-in, as the server does", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([registerEntry({ record: attendanceRecord({ check_in_time: "09:00:00" }) })]),
    );
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Half day");
    const checkOut = screen.getByLabelText("Check-out time for Amna Raza");
    fireEvent.change(checkOut, { target: { value: "08:30" } });

    expect(screen.getByText(LEAVES_EARLY)).toBeInTheDocument();
    expect(checkOut).toHaveAttribute("aria-invalid", "true");
    expect(submitButton()).toBeDisabled();

    fireEvent.change(checkOut, { target: { value: "12:00" } });

    expect(screen.queryByText(LEAVES_EARLY)).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it("puts a server error on a submitted row under that row", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([registerEntry(), bilal()]),
    );
    mocked(svc.studentAttendance.bulkMark).mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: LEAVES_EARLY,
        status: 400,
        url: "/student-attendance:bulk-mark",
        // DRF's ListField error, as `core.api.exceptions` flattens it: Bilal was sent second.
        details: [{ field: "entries.1.check_out_time", issue: LEAVES_EARLY }],
      }),
    );
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await user.click(screen.getByRole("button", { name: "Mark all present" }));
    await user.click(submitButton());

    const bilalRow = (
      await screen.findByRole("radiogroup", { name: "Status for Bilal Khan" })
    ).closest("li") as HTMLElement;
    expect(await within(bilalRow).findByText(LEAVES_EARLY)).toBeInTheDocument();
    const amnaRow = statusOf("Amna Raza").closest("li") as HTMLElement;
    expect(within(amnaRow).queryByText(LEAVES_EARLY)).not.toBeInTheDocument();
    // The banner carries it too, in the server's words.
    expect(screen.getByRole("alert")).toHaveTextContent(LEAVES_EARLY);
  });

  it("reloads on a 409 for locked rows, which then come back read-only", async () => {
    const unlocked = registerEntry({ record: attendanceRecord({ status: "present" }) });
    const locked = registerEntry({
      record: attendanceRecord({ status: "present", is_locked: true }),
    });
    mocked(svc.studentAttendance.fetchRegister)
      .mockResolvedValueOnce(registerOf([unlocked, bilal()]))
      .mockResolvedValue(registerOf([locked, bilal()]));
    mocked(svc.studentAttendance.bulkMark).mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: LOCKED_MESSAGE,
        status: 409,
        url: "/student-attendance:bulk-mark",
        details: [{ field: "non_field", issue: LOCKED_MESSAGE }],
      }),
    );
    const user = renderRegister();

    await screen.findByRole("radiogroup", { name: "Status for Amna Raza" });
    await mark(user, "Amna Raza", "Absent");
    await mark(user, "Bilal Khan", "Late");
    await user.click(submitButton());

    // The server's own words, then what the screen did about it.
    expect(await screen.findByText(/The register has been reloaded/)).toHaveTextContent(
      LOCKED_MESSAGE,
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("radiogroup", { name: "Status for Amna Raza" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Locked")).toBeInTheDocument();
    // Bilal's choice survives the reload.
    expect(radio("Bilal Khan", "Late")).toBeChecked();
  });

  it("renders a date that can't be marked read-only, with the reason", async () => {
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([registerEntry()], {
        markable: false,
        unmarkable_reason: "holiday",
        holiday_name: "Founders Day",
      }),
    );
    renderRegister();

    expect(
      await screen.findByText("Founders Day: the school is closed on this date."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.getByText("Not marked")).toBeInTheDocument();
  });

  it("offers a correction on a locked row to a holder of correction.create", async () => {
    asUser("attendance.correction.create");
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([
        registerEntry(),
        sara({ record: attendanceRecord({ student_id: THIRD_STUDENT_ID, is_locked: true }) }),
      ]),
    );
    const user = renderRegister();

    await user.click(
      await screen.findByRole("button", { name: "Request a correction for Sara Ali" }),
    );

    expect(await screen.findByRole("dialog", { name: "Request a correction" })).toBeInTheDocument();
    // The unlocked row is marked at the register, not corrected.
    expect(
      screen.queryByRole("button", { name: "Request a correction for Amna Raza" }),
    ).not.toBeInTheDocument();
  });

  it("offers no correction without correction.create", async () => {
    const locked = attendanceRecord({ student_id: THIRD_STUDENT_ID, is_locked: true });
    mocked(svc.studentAttendance.fetchRegister).mockResolvedValue(
      registerOf([sara({ record: locked })]),
    );
    renderRegister();

    await screen.findByText(USER_LOADED);
    await screen.findByText("Locked");
    expect(screen.queryByRole("button", { name: /Request a correction/ })).not.toBeInTheDocument();
  });

  it("names the server's reason when the register can't be read", async () => {
    // A daily read (no period) in a school now in period mode (`assert_period_fits_mode`).
    const issue = "This school takes attendance per period; name the period.";
    mocked(svc.studentAttendance.fetchRegister).mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: issue,
        status: 422,
        url: "/student-attendance/register",
        details: [{ field: "period_id", issue }],
      }),
    );
    renderRegister();

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
