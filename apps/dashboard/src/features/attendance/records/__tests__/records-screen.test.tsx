import { screen } from "@testing-library/react";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders } from "@/test-utils";

import { RecordsScreen } from "../records-screen";
import { fetchPage, stubRecordsServices } from "./records-test-support";

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

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <RecordsScreen />
    </>,
  );
  await screen.findByText(USER_LOADED);
}

describe("RecordsScreen", () => {
  beforeEach(stubRecordsServices);

  it("shows an import-only holder a note instead of the table, and loads no records", async () => {
    // `it_admin`'s default grant: the import key without the view key.
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["attendance.student-attendance.import"]),
    );
    await renderScreen();

    expect(await screen.findByText("Attendance import")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't be loaded/)).not.toBeInTheDocument();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("shows a viewer the records", async () => {
    await renderScreen();

    expect(await screen.findByText("Amna Raza")).toBeInTheDocument();
    expect(screen.queryByText("Attendance import")).not.toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalled();
  });
});
