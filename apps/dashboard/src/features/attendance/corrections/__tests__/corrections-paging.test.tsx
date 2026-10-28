import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";

import { correctionPage } from "@/services/modules/attendance-corrections/__tests__/attendance-corrections-fixtures";

import {
  amnaPending,
  bilalOwn,
  fetchPage,
  lastQuery,
  pageByCursor,
  pick,
  renderCorrections,
  stubCorrectionsServices,
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

/** Opens Corrections on page two of the two-page list. */
async function renderOnSecondPage() {
  pageByCursor();
  const user = await renderCorrections();
  await screen.findByText("Amna Raza");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Sara Ali");
  return user;
}

describe("CorrectionsTable paging", () => {
  beforeEach(stubCorrectionsServices);

  it("pages by cursor with Previous and Next, and no page numbers", async () => {
    pageByCursor();
    const user = await renderCorrections();
    await screen.findByText("Amna Raza");
    expect(screen.getByRole("navigation", { name: "Correction pages" })).toBeInTheDocument();
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

  it("starts over from the first page when a filter changes", async () => {
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

  it("starts over from the first page when Mine changes", async () => {
    const user = await renderOnSecondPage();

    await user.click(screen.getByRole("checkbox", { name: "Mine" }));

    await waitFor(() => {
      expect(lastQuery()).toEqual(expect.objectContaining({ mine: true, cursor: undefined }));
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
              url: "/attendance-corrections",
            }),
          )
        : Promise.resolve(correctionPage([amnaPending, bilalOwn], { next: "c2" })),
    );
    const user = await renderCorrections();
    await screen.findByText("Amna Raza");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(lastQuery()).toEqual(expect.objectContaining({ cursor: undefined }));
  });
});
