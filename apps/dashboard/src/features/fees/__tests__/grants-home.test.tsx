import { screen } from "@testing-library/react";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { GrantsHome } from "@/features/fees/grants/grants-home";
import { asUser } from "./fees-test-support";
import { stubGrantsServices } from "./grants-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

async function renderHome() {
  renderWithProviders(
    <>
      <UserLoaded />
      <GrantsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
}

describe("grants home", () => {
  it("shows a discount viewer Discounts and Scholarships, and no Fines tab", async () => {
    stubGrantsServices();
    asUser("fees.discount.view");
    await renderHome();

    expect(await screen.findByRole("tab", { name: "Discounts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scholarships" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Fines" })).not.toBeInTheDocument();
    expect(await screen.findByText("Sibling discount")).toBeInTheDocument();
  });

  it("shows a fine viewer only Fines, and opens on it", async () => {
    stubGrantsServices();
    asUser("fees.fine.view");
    await renderHome();

    expect(await screen.findByRole("tab", { name: "Fines" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Discounts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Scholarships" })).not.toBeInTheDocument();
    expect(await screen.findByText("Overdue library book")).toBeInTheDocument();
  });

  it("opens the tab the URL names", async () => {
    stubGrantsServices("/fees/grants?tab=scholarships");
    asUser("fees.discount.view", "fees.fine.view");
    await renderHome();

    expect(await screen.findByText("Merit award")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Scholarships" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
