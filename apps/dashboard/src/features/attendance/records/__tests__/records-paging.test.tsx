import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";

import { attendancePage } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import { amna, bilal, CLASS_ID } from "@/test-fixtures/attendance-records";

import {
  fetchPage,
  lastQuery,
  pageByCursor,
  pick,
  renderRecords,
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

/** Opens Records on page two of the two-page list. */
async function renderOnSecondPage() {
  pageByCursor();
  const user = await renderRecords();
  await screen.findByText("Amna Raza");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Sara Ali");
  return user;
}

describe("RecordsTable paging", () => {
  beforeEach(stubRecordsServices);

  it("pages by cursor with Previous and Next, and no page numbers", async () => {
    pageByCursor();
    const user = await renderRecords();
    await screen.findByText("Amna Raza");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Sara Ali")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: "c2" }));
    // The last page: nothing further, but a way back.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /page \d/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: undefined }));
  });

  it("starts over from the first page when a filter changes", async () => {
    const user = await renderOnSecondPage();

    await pick(user, "Status", "Absent");

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ status: "absent", cursor: undefined }));
    });
    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("starts over from the first page when the class changes", async () => {
    const user = await renderOnSecondPage();

    await pick(user, "Class", "Grade 5");

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ classId: CLASS_ID, cursor: undefined }),
      );
    });
    expect(urlParam("class")).toBe(CLASS_ID);
    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("starts over from the first page when the sort changes", async () => {
    const user = await renderOnSecondPage();

    // The default newest-first sort is cleared by one click on the Date header.
    await user.click(screen.getByRole("button", { name: "Date" }));
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(lastQuery()).toEqual(
        expect.objectContaining({ ordering: undefined, cursor: undefined }),
      );
    });
    expect(urlParam("sort")).toBe("none");
  });

  it("goes back to the first page on Retry after a later page fails", async () => {
    fetchPage.mockImplementation((query) =>
      query.cursor === "c2"
        ? Promise.reject(
            new ApiError({
              code: "not_found",
              message: "Invalid cursor.",
              status: 404,
              url: "/student-attendance",
            }),
          )
        : Promise.resolve(attendancePage([amna, bilal], { next: "c2" })),
    );
    const user = await renderRecords();
    await screen.findByText("Amna Raza");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: undefined }));
  });
});
