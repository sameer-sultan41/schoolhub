import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  OTHER_SCALE_ID,
  scalePage,
  scaleRecord,
} from "@/services/modules/grading-scales/__tests__/grading-scales-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { GradingScalesTable } from "../grading-scales-table";
import { GradingScalesToolbar } from "../grading-scales-toolbar";

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
    gradingScales: {
      fetchScalesPage: jest.fn(),
      createScale: jest.fn(),
      updateScale: jest.fn(),
      deleteScale: jest.fn(),
      setDefault: jest.fn(),
      fetchBands: jest.fn(),
    },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchScalesPage = Services.gradingScales.fetchScalesPage as jest.MockedFunction<
  typeof Services.gradingScales.fetchScalesPage
>;
const mockCreateScale = Services.gradingScales.createScale as jest.MockedFunction<
  typeof Services.gradingScales.createScale
>;
const mockDeleteScale = Services.gradingScales.deleteScale as jest.MockedFunction<
  typeof Services.gradingScales.deleteScale
>;
const mockSetDefault = Services.gradingScales.setDefault as jest.MockedFunction<
  typeof Services.gradingScales.setDefault
>;
const mockFetchBands = Services.gradingScales.fetchBands as jest.MockedFunction<
  typeof Services.gradingScales.fetchBands
>;

const IN_USE = "An exam still uses this grading scale.";
const NAME_TAKEN = "A grading scale with this name already exists.";

const VIEW: PermissionKey = "exams.grading-scale.view";

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser([VIEW, ...permissions]);
}

/** The default scale, and a second one that could be made the default. */
function twoScales() {
  return scalePage([
    scaleRecord(),
    scaleRecord({
      id: OTHER_SCALE_ID,
      name: "Honours GPA",
      scale_type: "gpa",
      gpa_max: "4.00",
      is_default: false,
      bands: [],
    }),
  ]);
}

function renderScreen() {
  renderWithProviders(
    <>
      <GradingScalesToolbar />
      <GradingScalesTable />
    </>,
  );
  return userEvent.setup();
}

describe("grading scales screen", () => {
  beforeEach(() => {
    setUrl("/exams/grading-scales");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(userWith("exams.grading-scale.create", "exams.grading-scale.update"));
    mockFetchScalesPage.mockReset().mockResolvedValue(twoScales());
    mockCreateScale.mockReset();
    mockDeleteScale.mockReset();
    mockSetDefault.mockReset();
    mockFetchBands.mockReset().mockResolvedValue([]);
  });

  it("lists each scale with its type, band count and default badge", async () => {
    renderScreen();

    const honours = (await screen.findByText("Honours GPA")).closest("tr");
    const standard = screen.getByText("Standard letters").closest("tr");
    if (!honours || !standard) throw new Error("rows not rendered");

    expect(within(standard).getByText("Letter grades")).toBeInTheDocument();
    expect(within(standard).getByText("2")).toBeInTheDocument();
    expect(within(standard).getByText("Default")).toBeInTheDocument();
    expect(within(honours).getByText("GPA")).toBeInTheDocument();
    expect(within(honours).getByText("0")).toBeInTheDocument();
    expect(within(honours).queryByText("Default")).not.toBeInTheDocument();
  });

  it("asks for the first page and sends the type filter from the URL", async () => {
    setUrl("/exams/grading-scales?type=gpa");

    renderScreen();

    await waitFor(() => {
      expect(mockFetchScalesPage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, scaleType: "gpa", ordering: "name" }),
      );
    });
  });

  it("hides every write control from a viewer holding only the view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith());

    renderScreen();

    expect(await screen.findByText("Honours GPA")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bands of Honours GPA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New grading scale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make .* the default/ })).not.toBeInTheDocument();
  });

  it("offers New, Edit and Make default to a holder of create and update, but not on the default scale", async () => {
    renderScreen();

    expect(await screen.findByRole("button", { name: "New grading scale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Honours GPA" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Make Honours GPA the default" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make Standard letters the default" }),
    ).not.toBeInTheDocument();
  });

  it("hides New from an updater without the create key", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith("exams.grading-scale.update"));

    renderScreen();

    expect(await screen.findByRole("button", { name: "Edit Honours GPA" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New grading scale" })).not.toBeInTheDocument();
  });

  it("makes a scale the default through setDefault, not an update", async () => {
    mockSetDefault.mockResolvedValue(scaleRecord({ id: OTHER_SCALE_ID, is_default: true }));
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Make Honours GPA the default" }));

    await waitFor(() => {
      expect(mockSetDefault).toHaveBeenCalledWith(OTHER_SCALE_ID);
    });
    expect(mockFetchScalesPage).toHaveBeenCalled();
  });

  it("puts a server refusal of the name under the Name field and keeps the dialog open", async () => {
    mockCreateScale.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: NAME_TAKEN,
        status: 422,
        url: "/grading-scales",
        details: [{ field: "name", issue: NAME_TAKEN }],
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "New grading scale" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Standard letters");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(NAME_TAKEN)).toBeInTheDocument();
    expect(mockCreateScale).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Standard letters", scaleType: "letter", gpaMax: null }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks for a name before sending a new scale", async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "New grading scale" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(mockCreateScale).not.toHaveBeenCalled();
  });

  it("keeps the remove dialog open with the server's reason when an exam uses the scale", async () => {
    mockDeleteScale.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: IN_USE,
        status: 422,
        url: "/grading-scales",
        details: [{ field: "non_field", issue: IN_USE }],
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Remove Honours GPA" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByText(IN_USE)).toBeInTheDocument();
  });
});
