import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";

import {
  correctionPage,
  correctionRecord,
  OTHER_CORRECTION_ID,
} from "@/services/modules/attendance-corrections/__tests__/attendance-corrections-fixtures";
import { STAFF_ROW_ID } from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";
import { setUrl } from "@/test-utils";

import {
  fetchPage,
  lastQuery,
  pick,
  renderCorrections,
  rowOf,
  stubCorrectionsServices,
  urlParam,
} from "./corrections-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ correctionsServicesMock: () => unknown }>("./corrections-services-mock")
    .correctionsServicesMock(),
);

/** Queries within the diff line that names `label`. */
function lineOf(row: ReturnType<typeof rowOf>, label: string) {
  const line = row.getByText(label).closest("li");
  if (!line) throw new Error(`no diff line for ${label}`);
  return within(line);
}

describe("CorrectionsTable", () => {
  beforeEach(stubCorrectionsServices);

  it("opens on the pending queue, newest first, one cursor page at a time", async () => {
    await renderCorrections();

    await screen.findByText("Amna Raza");
    expect(fetchPage).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 25,
      ordering: "-created_at",
      status: "pending",
      mine: undefined,
    });
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Pending");
    expect(screen.getByRole("checkbox", { name: "Mine" })).not.toBeChecked();
  });

  it("shows each request's student, date, period, reason, requester and status", async () => {
    await renderCorrections();

    await screen.findByText("Amna Raza");
    const pending = rowOf("Amna Raza");
    expect(pending.getByText("October 10th, 2026")).toBeInTheDocument();
    expect(pending.getByText("Gate log shows on time")).toBeInTheDocument();
    expect(pending.getByText("Imran Siddiqui")).toBeInTheDocument();
    expect(pending.getByText("Pending")).toBeInTheDocument();
    expect(pending.queryByText("Period 2")).not.toBeInTheDocument();

    const periodic = rowOf("Bilal Khan");
    expect(periodic.getByText("Period 2")).toBeInTheDocument();

    const decided = rowOf("Sara Ali");
    expect(decided.getByText("Approved")).toBeInTheDocument();
    expect(decided.getByText("Reviewed by Zainab Qureshi")).toBeInTheDocument();
    expect(decided.getByText("Verified with the parent")).toBeInTheDocument();
  });

  it("shows only the changed fields, before then after, with status labels", async () => {
    await renderCorrections();

    await screen.findByText("Amna Raza");
    // check-in time is named in both values but equal, so it is not a line of the diff.
    const amna = rowOf("Amna Raza");
    expect(amna.getAllByRole("listitem")).toHaveLength(2);
    const status = lineOf(amna, "Status");
    expect(status.getByText("Late")).toBeInTheDocument();
    expect(status.getByText("Present")).toBeInTheDocument();
    const remarks = lineOf(amna, "Remarks");
    expect(remarks.getByText("—")).toBeInTheDocument();
    expect(remarks.getByText("Gate log")).toBeInTheDocument();
    expect(amna.queryByText("Check-in time")).not.toBeInTheDocument();

    const time = lineOf(rowOf("Bilal Khan"), "Check-out time");
    expect(time.getByText("13:00")).toBeInTheDocument();
    expect(time.getByText("12:30")).toBeInTheDocument();
  });

  it("reads its filters from the address, and ignores a status it does not know", async () => {
    setUrl("/attendance/corrections?status=approved&mine=true");
    await renderCorrections();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(expect.objectContaining({ status: "approved", mine: true }));
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Approved");
    expect(screen.getByRole("checkbox", { name: "Mine" })).toBeChecked();
  });

  it("falls back to pending and no Mine for a value that is not valid", async () => {
    setUrl("/attendance/corrections?status=bogus&mine=maybe");
    await renderCorrections();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(expect.objectContaining({ status: "pending", mine: undefined }));
  });

  it("writes the status to the address and sends it, with All meaning no status", async () => {
    const user = await renderCorrections();
    await screen.findByText("Amna Raza");

    await pick(user, "Status", "All");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ status: undefined }));
    });
    expect(urlParam("status")).toBe("all");

    await pick(user, "Status", "Rejected");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ status: "rejected" }));
    });
    expect(urlParam("status")).toBe("rejected");

    await pick(user, "Status", "Pending");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ status: "pending" }));
    });
    // Pending is the default, so it leaves the address.
    expect(urlParam("status")).toBeNull();
  });

  it("maps the Mine toggle to the server's mine filter", async () => {
    const user = await renderCorrections();
    await screen.findByText("Amna Raza");

    await user.click(screen.getByRole("checkbox", { name: "Mine" }));

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ mine: true }));
    });
    expect(urlParam("mine")).toBe("true");

    await user.click(screen.getByRole("checkbox", { name: "Mine" }));

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ mine: undefined }));
    });
    expect(urlParam("mine")).toBeNull();
  });

  it("says nothing is waiting when the pending queue is empty", async () => {
    fetchPage.mockResolvedValue(correctionPage([]));
    await renderCorrections();

    expect(await screen.findByText("No correction requests")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("says no request matches when a filter narrowed the list to nothing", async () => {
    setUrl("/attendance/corrections?mine=true");
    fetchPage.mockResolvedValue(correctionPage([]));
    await renderCorrections();

    expect(await screen.findByText("No requests match these filters")).toBeInTheDocument();
  });

  it("shows the server's failure with the filters kept, and Try again reads again", async () => {
    setUrl("/attendance/corrections?status=rejected");
    fetchPage.mockRejectedValueOnce(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/attendance-corrections",
      }),
    );
    const user = await renderCorrections();

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Rejected");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
  });

  describe("student and staff rows", () => {
    /** Nadia's staff row, as the server sends a staff correction: the student fields null. */
    const nadiaStaff = correctionRecord({
      id: OTHER_CORRECTION_ID,
      subject_type: "staff",
      student_attendance_id: null,
      student_id: null,
      student_name: null,
      staff_attendance_id: STAFF_ROW_ID,
      staff_name: "Nadia Hussain",
      employee_number: "EMP-001",
      old_values: { status: "late", check_in_time: "08:40:00", check_out_time: null },
      new_values: { check_in_time: "08:05" },
    });

    it("names a staff row's staff member, and its period as the whole day", async () => {
      fetchPage.mockResolvedValue(correctionPage([correctionRecord(), nadiaStaff]));
      await renderCorrections();

      await screen.findByText("Nadia Hussain");
      const staff = rowOf("Nadia Hussain");
      expect(staff.getByText("Staff · EMP-001")).toBeInTheDocument();
      expect(staff.getByText("Whole day (staff)")).toBeInTheDocument();
      // A student's daily row keeps a blank period and no staff line.
      expect(rowOf("Amna Raza").queryByText("Whole day (staff)")).not.toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Student or staff" })).toBeInTheDocument();
    });

    it("narrows to staff rows through the address, and back to both", async () => {
      const user = await renderCorrections();
      await screen.findByText("Amna Raza");

      await pick(user, "Student or staff", "Staff");

      await waitFor(() => {
        expect(lastQuery()).toEqual(
          expect.objectContaining({ subjectType: "staff", cursor: undefined }),
        );
      });
      expect(urlParam("subject")).toBe("staff");

      await pick(user, "Student or staff", "All");

      await waitFor(() => {
        expect(lastQuery()).toEqual(expect.objectContaining({ subjectType: undefined }));
      });
      expect(urlParam("subject")).toBeNull();
    });

    it("reads the subject from the address", async () => {
      setUrl("/attendance/corrections?subject=student");
      await renderCorrections();
      await screen.findByText("Amna Raza");
      expect(lastQuery()).toEqual(expect.objectContaining({ subjectType: "student" }));
      expect(screen.getByRole("combobox", { name: "Student or staff" })).toHaveTextContent(
        "Student",
      );
    });

    it("ignores a subject it does not know", async () => {
      setUrl("/attendance/corrections?subject=teacher");
      await renderCorrections();
      await screen.findByText("Amna Raza");

      expect(lastQuery()).toEqual(expect.objectContaining({ subjectType: undefined }));
    });
  });
});
