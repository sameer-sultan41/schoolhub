import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  leavePage,
  SICK_TYPE_ID,
} from "@/services/modules/leave-requests/__tests__/leave-requests-fixtures";

import {
  amnaPending,
  bilalOwn,
  fetchPage,
  lastQuery,
  pageByCursor,
  pick,
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

/** Opens Leave on page two of the two-page list. */
async function renderOnSecondPage() {
  pageByCursor();
  const user = await renderLeave();
  await screen.findByText("Amna Raza");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Sara Ali");
  return user;
}

describe("LeaveTable paging", () => {
  beforeEach(stubLeaveServices);

  it("pages by cursor with Previous and Next, and no page numbers", async () => {
    pageByCursor();
    const user = await renderLeave();
    await screen.findByText("Amna Raza");
    expect(screen.getByRole("navigation", { name: "Leave pages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Sara Ali")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: "c2" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /page \d/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: undefined }));
  });

  it("starts over from the first page when the status changes", async () => {
    const user = await renderOnSecondPage();

    await pick(user, "Status", "Approved");

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ status: "approved", cursor: undefined }),
      );
    });
    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("starts over from the first page when the leave type changes", async () => {
    const user = await renderOnSecondPage();

    await pick(user, "Leave type", "Sick leave");

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ leaveTypeId: SICK_TYPE_ID, cursor: undefined }),
      );
    });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("starts over from the first page when a date changes", async () => {
    await renderOnSecondPage();

    fireEvent.change(screen.getByLabelText("Starts from"), { target: { value: "2026-10-01" } });

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ dateFrom: "2026-10-01", cursor: undefined }),
      );
    });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("goes back to the first page on Try again after a later page fails", async () => {
    fetchPage.mockImplementation((query) =>
      query.cursor === "c2"
        ? Promise.reject(
            new ApiError({
              code: "not_found",
              message: "Invalid cursor.",
              status: 404,
              url: "/leave-requests",
            }),
          )
        : Promise.resolve(leavePage([amnaPending, bilalOwn], { next: "c2" })),
    );
    const user = await renderLeave();
    await screen.findByText("Amna Raza");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: undefined }));
  });
});
