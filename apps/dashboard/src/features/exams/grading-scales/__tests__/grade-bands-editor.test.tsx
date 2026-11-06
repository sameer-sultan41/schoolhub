import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  BAND_ID,
  SCALE_ID,
  bandRecord,
  scaleRecord,
} from "@/services/modules/grading-scales/__tests__/grading-scales-fixtures";
import { buildUser, renderWithProviders } from "@/test-utils";

import { GradeBandsEditor } from "../grade-bands-editor";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    gradingScales: {
      fetchBands: jest.fn(),
      createBand: jest.fn(),
      updateBand: jest.fn(),
      deleteBand: jest.fn(),
    },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchBands = Services.gradingScales.fetchBands as jest.MockedFunction<
  typeof Services.gradingScales.fetchBands
>;
const mockCreateBand = Services.gradingScales.createBand as jest.MockedFunction<
  typeof Services.gradingScales.createBand
>;
const mockUpdateBand = Services.gradingScales.updateBand as jest.MockedFunction<
  typeof Services.gradingScales.updateBand
>;
const mockDeleteBand = Services.gradingScales.deleteBand as jest.MockedFunction<
  typeof Services.gradingScales.deleteBand
>;

const VIEW: PermissionKey = "exams.grading-scale.view";
const ABOVE_LOWER = "A band's upper bound must be above its lower bound.";

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser([VIEW, ...permissions]);
}

function band(id: string, label: string, min: string, max: string, sortOrder: number) {
  return bandRecord({ id, label, min_percent: min, max_percent: max, sort_order: sortOrder });
}

const SECOND_ID = "7f5a9b1c-3d4e-4f60-8a8b-0d2e4f6a8b02";

function renderEditor() {
  renderWithProviders(<GradeBandsEditor scale={scaleRecord()} />);
  return userEvent.setup();
}

describe("grade bands editor", () => {
  beforeEach(() => {
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(userWith("exams.grading-scale.create", "exams.grading-scale.update"));
    mockFetchBands
      .mockReset()
      .mockResolvedValue([
        band(BAND_ID, "A", "50.00", "100.00", 0),
        band(SECOND_ID, "F", "0.00", "49.99", 1),
      ]);
    mockCreateBand.mockReset();
    mockUpdateBand.mockReset();
    mockDeleteBand.mockReset();
  });

  it("lists the bands in the order the API sends them, and reads that scale's bands", async () => {
    renderEditor();

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("A")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("F")).toBeInTheDocument();
    expect(mockFetchBands).toHaveBeenCalledWith(SCALE_ID);
  });

  it("says the bands cover 0 to 100 when they meet with no gap or overlap", async () => {
    renderEditor();

    expect(
      await screen.findByText("The bands cover 0 to 100 with no gap or overlap."),
    ).toBeInTheDocument();
  });

  it("flags a gap between two bands, naming both", async () => {
    mockFetchBands.mockResolvedValue([
      band(BAND_ID, "Pass", "50", "100", 0),
      band(SECOND_ID, "Fail", "0", "40", 1),
    ]);

    renderEditor();

    expect(
      await screen.findByText(
        "Nothing grades a result between 40% and 50%: Fail and Pass leave a gap.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Check the coverage")).toBeInTheDocument();
  });

  it("flags an overlap between two bands", async () => {
    mockFetchBands.mockResolvedValue([
      band(BAND_ID, "Pass", "45", "100", 0),
      band(SECOND_ID, "Fail", "0", "50", 1),
    ]);

    renderEditor();

    expect(
      await screen.findByText("Fail ends at 50% and Pass starts at 45%, so they overlap."),
    ).toBeInTheDocument();
  });

  it("flags a scale that does not run from 0 to 100", async () => {
    mockFetchBands.mockResolvedValue([band(BAND_ID, "Pass", "10", "90", 0)]);

    renderEditor();

    expect(await screen.findByText(/starts at 10%/)).toBeInTheDocument();
    expect(screen.getByText(/ends at 90%/)).toBeInTheDocument();
  });

  it("says so when there are no bands yet", async () => {
    mockFetchBands.mockResolvedValue([]);

    renderEditor();

    expect(await screen.findByText(/No bands yet/)).toBeInTheDocument();
  });

  it("hides add, edit and remove from a viewer holding only the view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith());

    renderEditor();

    expect(await screen.findAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Add band" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit band/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove band/ })).not.toBeInTheDocument();
  });

  it("lets a creator without the update key add a band but not change one", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith("exams.grading-scale.create"));

    renderEditor();

    expect(await screen.findByRole("button", { name: "Add band" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit band/ })).not.toBeInTheDocument();
  });

  it("adds a band after the last, sending the percentages as typed", async () => {
    mockCreateBand.mockResolvedValue(bandRecord());
    const user = renderEditor();

    await user.click(await screen.findByRole("button", { name: "Add band" }));
    const form = screen.getByRole("form", { name: "Add a band" });
    expect(within(form).getByLabelText("Order")).toHaveAttribute("type", "number");
    await user.type(within(form).getByLabelText("Grade"), "C");
    await user.type(within(form).getByLabelText("From (%)"), "30");
    await user.type(within(form).getByLabelText("To (%)"), "49.99");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockCreateBand).toHaveBeenCalledWith(SCALE_ID, {
        label: "C",
        minPercent: "30",
        maxPercent: "49.99",
        gradePoint: null,
        isPassing: true,
        remark: null,
        sortOrder: 2,
      });
    });
  });

  it("puts the server's refusal of a band under its field", async () => {
    mockCreateBand.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: ABOVE_LOWER,
        status: 422,
        url: `/grading-scales/${SCALE_ID}/grade-bands`,
        details: [{ field: "max_percent", issue: ABOVE_LOWER }],
      }),
    );
    const user = renderEditor();

    await user.click(await screen.findByRole("button", { name: "Add band" }));
    const form = screen.getByRole("form", { name: "Add a band" });
    await user.type(within(form).getByLabelText("Grade"), "C");
    await user.type(within(form).getByLabelText("From (%)"), "60");
    await user.type(within(form).getByLabelText("To (%)"), "40");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await within(form).findByText(ABOVE_LOWER)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add a band" })).toBeInTheDocument();
  });

  it("edits a band from its own values", async () => {
    mockUpdateBand.mockResolvedValue(bandRecord());
    const user = renderEditor();

    await user.click(await screen.findByRole("button", { name: "Edit band F" }));
    const form = screen.getByRole("form", { name: "Edit this band" });
    await user.clear(within(form).getByLabelText("Remark"));
    await user.type(within(form).getByLabelText("Remark"), "Needs support");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateBand).toHaveBeenCalledWith(
        SCALE_ID,
        SECOND_ID,
        expect.objectContaining({ label: "F", remark: "Needs support", maxPercent: "49.99" }),
      );
    });
  });

  it("removes a band after confirming", async () => {
    mockDeleteBand.mockResolvedValue(undefined);
    const user = renderEditor();

    await user.click(await screen.findByRole("button", { name: "Remove band A" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDeleteBand).toHaveBeenCalledWith(SCALE_ID, BAND_ID);
    });
  });

  it("offers a way to try again when the bands cannot be loaded", async () => {
    mockFetchBands.mockRejectedValueOnce(new Error("offline"));
    const user = renderEditor();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findAllByRole("row")).toHaveLength(3);
  });
});
