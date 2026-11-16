import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  houseRecord,
  REFERENCED,
  structurePage,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { HousesSection } from "../houses-section";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    schoolOrganization: {
      fetchHousePage: jest.fn(),
      createHouse: jest.fn(),
      updateHouse: jest.fn(),
      deleteHouse: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

function renderSection() {
  renderWithProviders(<HousesSection />);
  return userEvent.setup();
}

describe("houses section", () => {
  beforeEach(() => {
    setUrl("/school/houses");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(
        buildUser([
          "school.house.view",
          "school.house.create",
          "school.house.update",
          "school.house.delete",
        ]),
      );
    so.fetchHousePage
      .mockReset()
      .mockResolvedValue(
        structurePage([
          houseRecord(),
          houseRecord({ id: "2b3c", name: "Blue", code: null, color: null, motto: null }),
        ]),
      );
    so.createHouse.mockReset();
    so.updateHouse.mockReset();
    so.deleteHouse.mockReset();
  });

  it("lists each house with its colour and motto, or a dash", async () => {
    renderSection();

    const red = await screen.findByRole("row", { name: /Red House/ });
    expect(within(red).getByText("#D32F2F")).toBeInTheDocument();
    expect(within(red).getByText("Courage first")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Blue/ })).getAllByText("—")).toHaveLength(3);
  });

  it("adds a house with a hex colour", async () => {
    so.createHouse.mockResolvedValue(houseRecord());
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add house" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Green");
    await user.type(within(dialog).getByLabelText("Colour"), "#2E7D32");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createHouse).toHaveBeenCalledWith({
        name: "Green",
        code: null,
        color: "#2E7D32",
        motto: null,
        is_active: true,
      });
    });
  });

  it("refuses a colour that is not hex before sending", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add house" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Green");
    await user.type(within(dialog).getByLabelText("Colour"), "green");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Enter a hex colour such as #1E88E5."),
    ).toBeInTheDocument();
    expect(so.createHouse).not.toHaveBeenCalled();
  });

  it("shows the server's name error under the name", async () => {
    const issue = "Ensure this field has no more than 80 characters.";
    so.updateHouse.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/houses",
        details: [{ field: "name", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Red House" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("removes a house, and says why when one is still in use", async () => {
    so.deleteHouse.mockRejectedValueOnce(
      new ApiError({
        code: "domain_rule_violation",
        message: REFERENCED,
        status: 422,
        url: "/houses",
        details: [{ field: "non_field", issue: REFERENCED }],
      }),
    );
    so.deleteHouse.mockResolvedValueOnce(undefined);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Remove Red House" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByText(REFERENCED)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(so.deleteHouse).toHaveBeenCalledTimes(2);
  });
});
