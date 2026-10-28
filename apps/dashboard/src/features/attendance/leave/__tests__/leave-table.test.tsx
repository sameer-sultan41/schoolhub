import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  CASUAL_TYPE_ID,
  leavePage,
  SICK_TYPE_ID,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";
import { setUrl } from "@/test-utils";

import {
  fetchPage,
  lastQuery,
  pick,
  renderLeave,
  rowOf,
  stubLeaveServices,
  urlParam,
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

describe("LeaveTable", () => {
  beforeEach(stubLeaveServices);

  it("opens on the pending queue, newest first, one cursor page at a time", async () => {
    await renderLeave();

    await screen.findByText("Amna Raza");
    expect(fetchPage).toHaveBeenCalledWith({
      cursor: undefined,
      pageSize: 25,
      ordering: "-created_at",
      status: "pending",
      leaveTypeId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Pending");
    expect(screen.getByRole("combobox", { name: "Leave type" })).toHaveTextContent("All");
  });

  it("shows a request's student, section, type, dates, day part, days, status, level", async () => {
    await renderLeave();

    await screen.findByText("Amna Raza");
    const span = rowOf("Amna Raza");
    expect(span.getByText("ADM-1042")).toBeInTheDocument();
    expect(span.getByText("Grade 5 A")).toBeInTheDocument();
    expect(span.getByText("Sick leave")).toBeInTheDocument();
    expect(span.getByText("October 26th, 2026 to October 28th, 2026")).toBeInTheDocument();
    expect(span.getByText("Full day")).toBeInTheDocument();
    expect(span.getByText("3")).toBeInTheDocument();
    expect(span.getByText("Pending")).toBeInTheDocument();
    expect(span.getByText("1 of 1")).toBeInTheDocument();
  });

  it("shows a single day once, a half day as such, and a missing section as a dash", async () => {
    await renderLeave();

    await screen.findByText("Bilal Khan");
    const half = rowOf("Bilal Khan");
    expect(half.getByText("October 30th, 2026")).toBeInTheDocument();
    expect(half.getByText("First half")).toBeInTheDocument();
    expect(half.getByText("0.5")).toBeInTheDocument();
    expect(half.getByText("Family event")).toBeInTheDocument();
    expect(half.getByText("—")).toBeInTheDocument();
  });

  it("shows the level out of the chain's length, and the status of a decided request", async () => {
    await renderLeave();

    await screen.findByText("Noor Qureshi");
    expect(rowOf("Noor Qureshi").getByText("2 of 2")).toBeInTheDocument();
    expect(rowOf("Noor Qureshi").getByText("12")).toBeInTheDocument();
    expect(rowOf("Usman Siddiqui").getByText("Approved")).toBeInTheDocument();
  });

  it("reads its filters from the address, and ignores a value it does not know", async () => {
    setUrl(`/attendance/leave?status=approved&type=${SICK_TYPE_ID}&from=2026-10-01&to=2026-10-31`);
    await renderLeave();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        status: "approved",
        leaveTypeId: SICK_TYPE_ID,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Approved");
    expect(screen.getByLabelText("Starts from")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Ends by")).toHaveValue("2026-10-31");
  });

  it("falls back to pending and no other filter for values that are not valid", async () => {
    setUrl("/attendance/leave?status=bogus&type=sick&from=2026-13-45&to=tomorrow");
    await renderLeave();

    await screen.findByText("Amna Raza");
    expect(lastQuery()).toEqual(
      expect.objectContaining({
        status: "pending",
        leaveTypeId: undefined,
        dateFrom: undefined,
        dateTo: undefined,
      }),
    );
  });

  it("writes the status to the address and sends it, with All meaning no status", async () => {
    const user = await renderLeave();
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

  it("offers the types a student can use, from the leave-types catalogue", async () => {
    const user = await renderLeave();
    await screen.findByText("Amna Raza");

    await user.click(screen.getByRole("combobox", { name: "Leave type" }));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "All",
      "Sick leave",
      "Family event",
    ]);
    // A staff-only type can never be on a student's request.
    expect(screen.queryByRole("option", { name: "Study leave" })).not.toBeInTheDocument();
  });

  it("filters by leave type through the address, and All clears it", async () => {
    const user = await renderLeave();
    await screen.findByText("Amna Raza");

    await pick(user, "Leave type", "Family event");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ leaveTypeId: CASUAL_TYPE_ID }));
    });
    expect(urlParam("type")).toBe(CASUAL_TYPE_ID);

    await pick(user, "Leave type", "All");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ leaveTypeId: undefined }));
    });
    expect(urlParam("type")).toBeNull();
  });

  it("sends the date range as the requests that start from and end by those dates", async () => {
    await renderLeave();
    await screen.findByText("Amna Raza");

    fireEvent.change(screen.getByLabelText("Starts from"), { target: { value: "2026-10-01" } });
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ dateFrom: "2026-10-01" }));
    });
    expect(urlParam("from")).toBe("2026-10-01");

    fireEvent.change(screen.getByLabelText("Ends by"), { target: { value: "2026-10-31" } });
    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ dateTo: "2026-10-31" }));
    });
    expect(urlParam("to")).toBe("2026-10-31");
  });

  it("says nothing is waiting when the pending queue is empty", async () => {
    fetchPage.mockResolvedValue(leavePage([]));
    await renderLeave();

    expect(await screen.findByText("No leave requests")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("says no request matches when a filter narrowed the list to nothing", async () => {
    setUrl(`/attendance/leave?type=${SICK_TYPE_ID}`);
    fetchPage.mockResolvedValue(leavePage([]));
    await renderLeave();

    expect(await screen.findByText("No requests match these filters")).toBeInTheDocument();
  });

  it("shows the server's failure with the filters kept, and Try again reads again", async () => {
    setUrl("/attendance/leave?status=rejected");
    fetchPage.mockRejectedValueOnce(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/leave-requests" }),
    );
    const user = await renderLeave();

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Rejected");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
  });
});
