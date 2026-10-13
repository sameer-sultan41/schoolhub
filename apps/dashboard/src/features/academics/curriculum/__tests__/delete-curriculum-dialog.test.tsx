import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  curriculumRecord,
  RECORD_ID,
} from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { renderWithProviders } from "@/test-utils";

import { DeleteCurriculumDialog } from "../delete-curriculum-dialog";

// Removing surfaces as a toast, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { curriculum: { deleteCurriculum: jest.fn() } },
}));

const mockDeleteCurriculum = Services.curriculum.deleteCurriculum as jest.MockedFunction<
  typeof Services.curriculum.deleteCurriculum
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

function renderDelete() {
  const onOpenChange = jest.fn();
  renderWithProviders(
    <DeleteCurriculumDialog open onOpenChange={onOpenChange} record={curriculumRecord()} />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

/** A 422 refusal, as the API words them: `field` is `non_field` or the field it names. */
function refusal(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: `/class-subjects/${RECORD_ID}`,
    details: [{ field, issue }],
  });
}

describe("DeleteCurriculumDialog", () => {
  beforeEach(() => {
    mockDeleteCurriculum.mockReset().mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("names the subject being removed", () => {
    renderDelete();

    expect(screen.getByRole("alertdialog", { name: "Remove this subject" })).toHaveTextContent(
      "Mathematics will no longer be part of this class's curriculum for the session.",
    );
  });

  it("removes the mapping, refreshes the curriculum, toasts and closes", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockDeleteCurriculum).toHaveBeenCalledWith(RECORD_ID);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["curriculum"] });
    expect(mockToastSuccess).toHaveBeenCalledWith("Subject removed from the curriculum.");
  });

  it("shows the elective-group refusal inline and stays open", async () => {
    const issue = "Removing this leaves 'Languages' with no options. An elective group needs two.";
    mockDeleteCurriculum.mockRejectedValue(refusal("elective_group", issue));
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Remove this subject" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("shows a refusal that names no field (a locked session) inline", async () => {
    const issue = "Academic session '2025-26' is closed and cannot be modified.";
    mockDeleteCurriculum.mockRejectedValue(refusal("non_field", issue));
    const { user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
  });

  it("clears the refusal when it is tried again, and closes once it succeeds", async () => {
    const issue = "Removing this leaves 'Languages' with no options. An elective group needs two.";
    mockDeleteCurriculum.mockRejectedValueOnce(refusal("elective_group", issue));
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(issue)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.queryByText(issue)).not.toBeInTheDocument();
    expect(mockDeleteCurriculum).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic message for a failure that isn't an API error", async () => {
    mockDeleteCurriculum.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Remove" }));

    const message = await screen.findByText("Something went wrong. Please try again.");
    expect(message).toBeInTheDocument();
  });

  it("closes without removing on Cancel", async () => {
    const { onOpenChange, user } = renderDelete();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockDeleteCurriculum).not.toHaveBeenCalled();
  });
});
