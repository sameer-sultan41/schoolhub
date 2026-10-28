import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";

import { todayIsoDate } from "@/lib/helpers";
import {
  staffAttendancePage,
  staffRecord,
} from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";
import { shiftIsoDate } from "@/services/modules/student-attendance/student-attendance-helper";
import { cursorPages, lastArg, pick } from "@/test-fixtures/list-screen";
import { setUrl } from "@/test-utils";

import {
  asUser,
  CORRECT,
  fetchHistory,
  fetchRegister,
  MARK,
  omarRecord,
  renderStaff,
  rowOf,
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

/** The viewer's own day: a self check-in, late and checked out early. */
const ownLate = staffRecord({
  status: "late",
  check_in_time: "08:40:00",
  check_out_time: "13:00:00",
  late_minutes: 40,
  early_departure_minutes: 60,
  source: "self",
});
/** A locked holiday row a week earlier. */
const lockedHoliday = staffRecord({
  id: "88888888-aaaa-4bbb-8ccc-000000000009",
  attendance_date: "2026-10-16",
  status: "holiday",
  check_in_time: null,
  is_locked: true,
});

/** A staff member without the mark key: the history is all they get. */
function asOwnScopedViewer(...keys: Parameters<typeof asUser>) {
  setUrl("/attendance/staff");
  asUser(...keys);
  fetchHistory.mockResolvedValue(staffAttendancePage([ownLate, lockedHoliday]));
}

const lastQuery = () => lastArg(fetchHistory);

describe("Staff history", () => {
  beforeEach(() => {
    stubStaffServices();
  });

  it("gives a viewer without the mark key their history alone, never the register", async () => {
    asOwnScopedViewer();
    await renderStaff();

    expect(await screen.findByText("October 23rd, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(fetchRegister).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "The staff attendance records you may see, newest day first: your own, unless your " +
          "role covers more. A record past the lock window can only be changed through a " +
          "correction.",
      ),
    ).toBeInTheDocument();
    // The last 30 days, newest first, one cursor page at a time.
    expect(fetchHistory).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 25,
      ordering: "-attendance_date",
      dateFrom: shiftIsoDate(todayIsoDate(), -29),
      dateTo: todayIsoDate(),
      status: undefined,
    });
  });

  it("shows each record's times, minutes, source and lock", async () => {
    asOwnScopedViewer();
    await renderStaff();

    await screen.findByText("October 23rd, 2026");
    const own = rowOf("October 23rd, 2026");
    expect(own.getByText("Nadia Hussain")).toBeInTheDocument();
    expect(own.getByText("Late")).toBeInTheDocument();
    expect(own.getByText("08:40")).toBeInTheDocument();
    expect(own.getByText("13:00")).toBeInTheDocument();
    expect(own.getByText("40")).toBeInTheDocument();
    expect(own.getByText("60")).toBeInTheDocument();
    expect(own.getByText("Self check-in")).toBeInTheDocument();
    expect(own.queryByText("Locked")).not.toBeInTheDocument();

    const holiday = rowOf("October 16th, 2026");
    expect(holiday.getByText("Holiday")).toBeInTheDocument();
    expect(holiday.getByText("Locked")).toBeInTheDocument();
  });

  it("offers Request correction on a locked row only, to a holder of the key", async () => {
    asOwnScopedViewer(CORRECT);
    const { user } = await renderStaff();
    await screen.findByText("October 23rd, 2026");

    const own = rowOf("October 23rd, 2026");
    expect(
      own.queryByRole("button", { name: "Request a correction for Nadia Hussain" }),
    ).not.toBeInTheDocument();
    await user.click(
      rowOf("October 16th, 2026").getByRole("button", {
        name: "Request a correction for Nadia Hussain",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Request a correction" });
    expect(within(dialog).queryByLabelText("Remarks")).not.toBeInTheDocument();
  });

  it("offers no correction without correction.create", async () => {
    asOwnScopedViewer();
    await renderStaff();
    await screen.findByText("October 16th, 2026");

    expect(screen.queryByRole("button", { name: /Request a correction/ })).not.toBeInTheDocument();
  });

  it("filters by any staff status, holiday included, starting again from page one", async () => {
    asOwnScopedViewer();
    fetchHistory.mockImplementation(
      cursorPages(
        staffAttendancePage([ownLate], { next: "c2" }),
        staffAttendancePage([lockedHoliday], { previous: "c1" }),
      ),
    );
    const { user } = await renderStaff();
    await screen.findByText("October 23rd, 2026");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("October 16th, 2026");
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: "c2" }));

    await pick(user, "Status", "Holiday");

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ status: "holiday", cursor: undefined }),
      );
    });
    expect(urlParam("status")).toBe("holiday");
  });

  it("starts over from page one when Try again follows a failed later page", async () => {
    asOwnScopedViewer();
    fetchHistory.mockImplementation((query) =>
      query.cursor === "c2"
        ? Promise.reject(
            new ApiError({
              code: "validation_error",
              message: "Invalid cursor",
              status: 400,
              url: "/staff-attendance",
              details: [],
            }),
          )
        : Promise.resolve(staffAttendancePage([ownLate], { next: "c2" })),
    );
    const { user } = await renderStaff();
    await screen.findByText("October 23rd, 2026");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("October 23rd, 2026")).toBeInTheDocument();
    // Back on page one: nowhere earlier to go.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("gives a marker the history as a second tab, kept in the address", async () => {
    asUser(MARK);
    fetchHistory.mockResolvedValue(staffAttendancePage([omarRecord]));
    const { user } = await renderStaff();
    await screen.findByRole("list", { name: "Staff" });

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(rowOf("Omar Farooq").getByText("EMP-002")).toBeInTheDocument();
    expect(urlParam("view")).toBe("history");
    expect(screen.queryByRole("list", { name: "Staff" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Register" }));

    expect(await screen.findByRole("list", { name: "Staff" })).toBeInTheDocument();
    // The register is the default view, so it leaves the address.
    expect(urlParam("view")).toBeNull();
  });

  it("opens a marker's history straight from the address", async () => {
    setUrl("/attendance/staff?view=history");
    await renderStaff();

    expect(await screen.findByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => {
      expect(fetchHistory).toHaveBeenCalled();
    });
    expect(fetchRegister).not.toHaveBeenCalled();
  });
});
