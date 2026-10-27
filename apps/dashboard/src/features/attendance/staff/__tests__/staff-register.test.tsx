import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { shiftIsoDate } from "@/services/modules/student-attendance/student-attendance-helper";
import {
  domainRefusal,
  HOLIDAY_REFUSAL,
  LOCKED_MARK,
  lockedConflict,
  STAFF_ID,
  staffRecord,
  staffRegisterEntry,
} from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";
import { todayIsoDate } from "@/lib/helpers";
import { setUrl } from "@/test-utils";

import {
  asUser,
  CORRECT,
  DATE,
  fetchHistory,
  fetchRegister,
  MARK,
  markStaff,
  nadia,
  omar,
  omarRecord,
  renderStaff,
  sara,
  staffRow,
  stubStaffServices,
  urlParam,
} from "./staff-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ staffServicesMock: () => unknown }>("./staff-services-mock")
    .staffServicesMock(),
);

const statusOf = (name: string) => screen.getByRole("radiogroup", { name: `Status for ${name}` });
const radio = (name: string, status: string) =>
  within(statusOf(name)).getByRole("radio", { name: status });
const ABSENT_HINT = "Absent clears this day's check-in and check-out when saved.";
const saveButton = (name: string) =>
  screen.getByRole("button", { name: `Save attendance for ${name}` });

describe("StaffRegister", () => {
  beforeEach(() => {
    stubStaffServices();
  });

  it("opens the URL's date with one row per staff member, each in its own state", async () => {
    await renderStaff();

    const rows = within(await screen.findByRole("list", { name: "Staff" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(3);
    expect(fetchRegister).toHaveBeenCalledWith({ date: DATE });
    // The register is the marker's default view; the history isn't read until it is opened.
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute("aria-selected", "true");
    expect(fetchHistory).not.toHaveBeenCalled();

    expect(staffRow("Nadia Hussain").getByText("EMP-001")).toBeInTheDocument();
    expect(staffRow("Nadia Hussain").getByText("Science")).toBeInTheDocument();
    expect(radio("Omar Farooq", "Present")).toBeChecked();
    // Sara's row is locked: her status is shown, not offered.
    expect(staffRow("Sara Qureshi").getByText("Late")).toBeInTheDocument();
    expect(staffRow("Sara Qureshi").getByText("Locked")).toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Status for Sara Qureshi" }),
    ).not.toBeInTheDocument();
  });

  it("offers the four staff statuses, never on leave or holiday", async () => {
    await renderStaff();

    await screen.findByRole("radiogroup", { name: "Status for Nadia Hussain" });
    const options = within(statusOf("Nadia Hussain"))
      .getAllByRole("radio")
      .map((option) => option.textContent);
    expect(options).toEqual(["Present", "Absent", "Late", "Half day"]);
  });

  it("saves one row on its own and shows what the server wrote", async () => {
    markStaff.mockResolvedValue(
      staffRecord({
        status: "late",
        check_in_time: "08:40:00",
        late_minutes: 40,
        remarks: "Bus late",
        updated_at: "2026-10-23T08:45:00Z",
      }),
    );
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Nadia Hussain" });
    // Nothing picked yet: nothing to save.
    expect(saveButton("Nadia Hussain")).toBeDisabled();

    await user.click(radio("Nadia Hussain", "Late"));
    fireEvent.change(screen.getByLabelText("Check-in time for Nadia Hussain"), {
      target: { value: "08:40" },
    });
    await user.type(screen.getByLabelText("Remarks for Nadia Hussain"), "Bus late");
    await user.click(saveButton("Nadia Hussain"));

    await waitFor(() => {
      expect(markStaff).toHaveBeenCalledWith({
        staffId: STAFF_ID,
        attendanceDate: DATE,
        status: "late",
        checkInTime: "08:40",
        checkOutTime: null,
        remarks: "Bus late",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Attendance saved for Nadia Hussain.");
    // The saved row starts again from the record: nothing left to save, and she can check out.
    await waitFor(() => {
      expect(saveButton("Nadia Hussain")).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Check out Nadia Hussain" })).toBeInTheDocument();
    expect(markStaff).toHaveBeenCalledTimes(1);
    // Written into the cache, not read again.
    expect(fetchRegister).toHaveBeenCalledTimes(1);
  });

  it("sends an absent day with no times, hiding its check-in and saying so", async () => {
    const outAt = { ...omarRecord, check_out_time: "16:30:00" };
    stubStaffServices([staffRegisterEntry({ ...omar, record: outAt })]);
    markStaff.mockResolvedValue({ ...outAt, status: "absent", check_in_time: null });
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Omar Farooq" });
    expect(screen.getByLabelText("Check-in time for Omar Farooq")).toHaveValue("08:00");

    await user.click(radio("Omar Farooq", "Absent"));

    expect(screen.queryByLabelText("Check-in time for Omar Farooq")).not.toBeInTheDocument();
    expect(staffRow("Omar Farooq").getByText(ABSENT_HINT)).toBeInTheDocument();
    await user.click(saveButton("Omar Farooq"));
    await waitFor(() => {
      expect(markStaff).toHaveBeenCalledWith(
        expect.objectContaining({ status: "absent", checkInTime: null, checkOutTime: null }),
      );
    });
  });

  it("gives no times-cleared hint on a row with no saved times", async () => {
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Nadia Hussain" });

    await user.click(radio("Nadia Hussain", "Absent"));

    expect(screen.queryByText(ABSENT_HINT)).not.toBeInTheDocument();
  });

  it("keeps the saved times, seconds and all, when only the remarks change", async () => {
    // A self check-in keeps the seconds it was recorded with.
    const outAt = { ...omarRecord, check_in_time: "08:03:27", check_out_time: "16:30:00" };
    stubStaffServices([staffRegisterEntry({ ...omar, record: outAt })]);
    markStaff.mockResolvedValue({ ...outAt, remarks: "Left for a meeting" });
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Omar Farooq" });
    expect(staffRow("Omar Farooq").getByText("Out at 16:30")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Remarks for Omar Farooq"), "Left for a meeting");
    await user.click(saveButton("Omar Farooq"));

    await waitFor(() => {
      expect(markStaff).toHaveBeenCalledWith(
        expect.objectContaining({ checkInTime: "08:03:27", checkOutTime: "16:30:00" }),
      );
    });
  });

  it("shows a refusal on its row and keeps every other row's choices", async () => {
    markStaff.mockRejectedValue(
      domainRefusal("attendance_date", HOLIDAY_REFUSAL, "/staff-attendance"),
    );
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Nadia Hussain" });
    await user.click(radio("Omar Farooq", "Absent"));

    await user.click(radio("Nadia Hussain", "Present"));
    await user.click(saveButton("Nadia Hussain"));

    expect(await staffRow("Nadia Hussain").findByRole("alert")).toHaveTextContent(HOLIDAY_REFUSAL);
    expect(radio("Nadia Hussain", "Present")).toBeChecked();
    // Omar's unsaved choice is untouched.
    expect(radio("Omar Farooq", "Absent")).toBeChecked();
    // The next edit clears the message.
    await user.click(radio("Nadia Hussain", "Late"));
    expect(staffRow("Nadia Hussain").queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the register when a row locked since it loaded", async () => {
    markStaff.mockRejectedValue(lockedConflict(LOCKED_MARK, "/staff-attendance"));
    const lockedOmar = { ...omar, record: { ...omarRecord, is_locked: true } };
    const { user } = await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Omar Farooq" });
    fetchRegister.mockResolvedValue([nadia, lockedOmar, sara]);

    await user.click(radio("Omar Farooq", "Late"));
    await user.click(saveButton("Omar Farooq"));

    expect(await staffRow("Omar Farooq").findByRole("alert")).toHaveTextContent(LOCKED_MARK);
    await waitFor(() => {
      expect(staffRow("Omar Farooq").getByText("Locked")).toBeInTheDocument();
    });
    expect(fetchRegister).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("radiogroup", { name: "Status for Omar Farooq" }),
    ).not.toBeInTheDocument();
  });

  it("offers Check out only on a checked-in, unlocked row not yet checked out", async () => {
    const outAt = staffRegisterEntry({
      staff_id: "66666666-aaaa-4bbb-8ccc-000000000004",
      staff_name: "Hina Malik",
      employee_number: "EMP-004",
      record: staffRecord({
        id: "88888888-aaaa-4bbb-8ccc-000000000004",
        staff_id: "66666666-aaaa-4bbb-8ccc-000000000004",
        staff_name: "Hina Malik",
        check_out_time: "16:30:00",
      }),
    });
    stubStaffServices([nadia, omar, sara, outAt]);
    await renderStaff();
    await screen.findByRole("radiogroup", { name: "Status for Nadia Hussain" });

    expect(screen.getByRole("button", { name: "Check out Omar Farooq" })).toBeInTheDocument();
    // Not marked, locked, or already out: nothing to check out.
    for (const name of ["Nadia Hussain", "Sara Qureshi", "Hina Malik"]) {
      expect(screen.queryByRole("button", { name: `Check out ${name}` })).not.toBeInTheDocument();
    }
    expect(staffRow("Hina Malik").getByText("Out at 16:30")).toBeInTheDocument();
  });

  it("offers no Request correction without correction.create", async () => {
    await renderStaff();
    await screen.findByText("Sara Qureshi");
    expect(
      screen.queryByRole("button", { name: "Request a correction for Sara Qureshi" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Rows past the lock window are read-only.")).toBeInTheDocument();
  });

  it("opens the correction dialog for a locked staff row", async () => {
    asUser(MARK, CORRECT);
    const { user } = await renderStaff();

    await user.click(
      await screen.findByRole("button", { name: "Request a correction for Sara Qureshi" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Request a correction" });
    expect(within(dialog).getByText(/^Sara Qureshi, October 23rd, 2026\./)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Check-in time")).toHaveValue("08:40");
    // A staff correction has no remarks.
    expect(within(dialog).queryByLabelText("Remarks")).not.toBeInTheDocument();
    // An unlocked row offers no correction: it is edited in place.
    expect(
      screen.queryByRole("button", { name: "Request a correction for Omar Farooq" }),
    ).not.toBeInTheDocument();
  });

  it("shows approved leave read-only", async () => {
    stubStaffServices([staffRegisterEntry({ on_leave: true })]);
    await renderStaff();
    await screen.findByText("Nadia Hussain");

    expect(await staffRow("Nadia Hussain").findByText("On leave")).toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "Status for Nadia Hussain" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save attendance/ })).not.toBeInTheDocument();
  });

  it("keeps a future date read-only, as the server refuses it", async () => {
    setUrl(`/attendance/staff?date=${shiftIsoDate(todayIsoDate(), 1)}`);
    await renderStaff();

    expect(
      await screen.findByText(
        "Attendance records what happened, so this date can't be marked yet.",
      ),
    ).toBeInTheDocument();
    expect(staffRow("Nadia Hussain").getByText("Not marked")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("reads another date's register when the date changes, and today without one", async () => {
    setUrl("/attendance/staff");
    await renderStaff();
    await screen.findByRole("list", { name: "Staff" });
    expect(fetchRegister).toHaveBeenCalledWith({ date: todayIsoDate() });

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-20" } });

    await waitFor(() => {
      expect(fetchRegister).toHaveBeenLastCalledWith({ date: "2026-10-20" });
    });
    expect(urlParam("date")).toBe("2026-10-20");
  });
});
