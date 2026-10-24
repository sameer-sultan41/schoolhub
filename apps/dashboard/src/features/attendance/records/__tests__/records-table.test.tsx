import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { todayIsoDate } from "@/lib/helpers";
import {
  attendancePage,
  SECTION_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { shiftIsoDate } from "@/services/modules/student-attendance/student-attendance-helper";
import { amna, CLASS_ID } from "@/test-fixtures/attendance-records";
import { setUrl } from "@/test-utils";

import {
  fetchPage,
  lastQuery,
  pick,
  renderRecords,
  rowOf,
  stubRecordsServices,
  urlParam,
} from "./records-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ recordsServicesMock: () => unknown }>("./records-services-mock")
    .recordsServicesMock(),
);

const OTHER_CLASS_SECTION_ID = "11111111-aaaa-4bbb-8ccc-0000000000ff";

describe("RecordsTable", () => {
  beforeEach(stubRecordsServices);

  it("opens on the last 7 days, newest first, one cursor page at a time", async () => {
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(fetchPage).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 25,
      ordering: "-attendance_date",
      dateFrom: shiftIsoDate(todayIsoDate(), -6),
      dateTo: todayIsoDate(),
      classId: undefined,
      sectionId: undefined,
      status: undefined,
      isLocked: undefined,
    });
    expect(screen.getByLabelText("From date")).toHaveValue(shiftIsoDate(todayIsoDate(), -6));
    expect(screen.getByLabelText("To date")).toHaveValue(todayIsoDate());
  });

  it("shows each record's columns, a daily row and a locked period row", async () => {
    await renderRecords();

    await screen.findByText("Amna Raza");
    const daily = rowOf("Amna Raza");
    expect(daily.getByText("ADM-001")).toBeInTheDocument();
    expect(daily.getByText("Grade 5-A")).toBeInTheDocument();
    expect(daily.getByText("October 23rd, 2026")).toBeInTheDocument();
    expect(daily.getByText("Present")).toBeInTheDocument();
    expect(daily.getByText("Manual")).toBeInTheDocument();
    expect(daily.queryByText("Period 2")).not.toBeInTheDocument();
    expect(daily.queryByText("Locked")).not.toBeInTheDocument();

    const periodic = rowOf("Bilal Khan");
    expect(periodic.getByText("Period 2")).toBeInTheDocument();
    expect(periodic.getByText("Late")).toBeInTheDocument();
    expect(periodic.getByText("20")).toBeInTheDocument();
    expect(periodic.getByText("Import")).toBeInTheDocument();
    expect(periodic.getByText("Locked")).toBeInTheDocument();
  });

  it("reads its filters from the address, and ignores a value it does not know", async () => {
    setUrl(
      `/attendance/records?from=2026-10-01&to=2026-10-05&class=${CLASS_ID}` +
        `&section=${SECTION_ID}&status=late&locked=open`,
    );
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        dateFrom: "2026-10-01",
        dateTo: "2026-10-05",
        classId: CLASS_ID,
        sectionId: SECTION_ID,
        status: "late",
        isLocked: false,
      }),
    );
    // The section is the picked one, shown by name.
    expect(screen.getByRole("combobox", { name: "Section" })).toHaveTextContent("A");
  });

  it("falls back to no filter for a status, lock, class or section that is not valid", async () => {
    setUrl("/attendance/records?status=bogus&locked=maybe&class=nope&section=not-an-id");
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        classId: undefined,
        sectionId: undefined,
        status: undefined,
        isLocked: undefined,
      }),
    );
  });

  it("falls back to the default dates for a date that is not on the calendar", async () => {
    setUrl("/attendance/records?from=2026-13-45&to=2026-02-30");
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        dateFrom: shiftIsoDate(todayIsoDate(), -6),
        dateTo: todayIsoDate(),
      }),
    );
  });

  it("drops a section in the address that has no class, so no filter is invisible", async () => {
    setUrl(`/attendance/records?section=${SECTION_ID}`);
    await renderRecords();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({ classId: undefined, sectionId: undefined }),
    );
    expect(screen.getByRole("combobox", { name: "Section" })).toBeDisabled();
  });

  it("drops a section that is not in the picked class, once its sections are known", async () => {
    setUrl(`/attendance/records?class=${CLASS_ID}&section=${OTHER_CLASS_SECTION_ID}`);
    await renderRecords();

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ classId: CLASS_ID, sectionId: undefined }),
      );
    });
  });

  it("writes each filter to the address and queries with it", async () => {
    const user = await renderRecords();
    await screen.findByText("Amna Raza");

    await pick(user, "Status", "Absent");
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ status: "absent" }));
    });
    expect(urlParam("status")).toBe("absent");

    await pick(user, "Locked", "Locked");
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ isLocked: true }));
    });
    expect(urlParam("locked")).toBe("locked");

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ dateFrom: "2026-10-01" }));
    });
    expect(urlParam("from")).toBe("2026-10-01");

    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-20" } });
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ dateTo: "2026-10-20" }));
    });
    expect(urlParam("to")).toBe("2026-10-20");
  });

  it("filters by class, then by its section, and a new class clears the section", async () => {
    const user = await renderRecords();
    await screen.findByText("Amna Raza");
    expect(screen.getByRole("combobox", { name: "Section" })).toBeDisabled();

    await pick(user, "Class", "Grade 5");
    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ classId: CLASS_ID, sectionId: undefined }),
      );
    });
    expect(urlParam("class")).toBe(CLASS_ID);

    await pick(user, "Section", "A");
    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ classId: CLASS_ID, sectionId: SECTION_ID }),
      );
    });
    expect(urlParam("section")).toBe(SECTION_ID);

    await pick(user, "Class", "All");
    expect(urlParam("class")).toBeNull();
    expect(urlParam("section")).toBeNull();
    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ classId: undefined, sectionId: undefined }),
      );
    });
  });

  it("says nothing was marked in an empty date range", async () => {
    fetchPage.mockResolvedValue(attendancePage([]));
    await renderRecords();

    expect(await screen.findByText("No attendance records")).toBeInTheDocument();
  });

  it("says no record matches when a filter is on", async () => {
    setUrl("/attendance/records?status=late");
    fetchPage.mockResolvedValue(attendancePage([]));
    await renderRecords();

    expect(await screen.findByText("No records match these filters")).toBeInTheDocument();
  });

  it("shows the server's sentence on a failed load, and Retry reads again", async () => {
    fetchPage.mockRejectedValueOnce(
      new ApiError({
        code: "forbidden",
        message: "You do not have permission to perform this action.",
        status: 403,
        url: "/student-attendance",
      }),
    );
    const user = await renderRecords();

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
  });

  it("keeps the filters on a failed load, so the one that caused it can be changed", async () => {
    setUrl("/attendance/records?status=late");
    // A filter value the API refuses is a 400 `validation_error` naming the filter; the card
    // shows that code's own translation (`resolveErrorMessage`), not the field's sentence.
    fetchPage.mockRejectedValueOnce(
      new ApiError({
        code: "validation_error",
        message: "Enter a valid date.",
        status: 400,
        url: "/student-attendance",
        details: [{ field: "date__gte", issue: "Enter a valid date." }],
      }),
    );
    const user = await renderRecords();

    expect(await screen.findByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Late");
    expect(screen.getByLabelText("From date")).toBeInTheDocument();

    await pick(user, "Status", "All");

    expect(await screen.findByText(amna.student_name)).toBeInTheDocument();
    expect(urlParam("status")).toBeNull();
  });
});
