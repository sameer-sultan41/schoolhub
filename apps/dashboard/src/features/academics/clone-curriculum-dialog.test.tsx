import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloneCurriculumDialog } from "@/features/academics/clone-curriculum-dialog";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({
    data: [
      { id: "sess1", name: "2025-26" },
      { id: "sess2", name: "2026-27" },
    ],
  }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

async function openAndPick(source: string, target: string) {
  const user = userEvent.setup();
  renderWithProviders(<CloneCurriculumDialog />);
  await user.click(screen.getByRole("button", { name: "Clone from another session" }));

  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "Copy from" }));
  await user.click(await screen.findByRole("option", { name: source }));
  await user.click(within(dialog).getByRole("combobox", { name: "Copy into" }));
  await user.click(await screen.findByRole("option", { name: target }));

  return { user, dialog };
}

describe("CloneCurriculumDialog", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("posts both sessions with an idempotency key and reports the row counts", async () => {
    mockPost.mockResolvedValue({
      data: { created: 12, skipped: 3 },
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/class-subjects:clone",
        { source_academic_session_id: "sess1", target_academic_session_id: "sess2" },
        { idempotencyKey: expect.any(String) as string },
      );
    });
    expect(await screen.findByText("12 mappings created, 3 already present.")).toBeInTheDocument();
  });

  it("refuses to clone a session onto itself before reaching the server", async () => {
    const { user, dialog } = await openAndPick("2025-26", "2025-26");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    expect(await screen.findByText("Source and target sessions must differ.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("puts a server field error on the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/class-subjects:clone",
        details: [
          { field: "source_academic_session_id", issue: "Source and target sessions must differ." },
        ],
      }),
    );

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    expect(await screen.findByText("Source and target sessions must differ.")).toBeInTheDocument();
  });

  it("routes a field the form does not render into the root message", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/class-subjects:clone",
        details: [{ field: "non_field", issue: "That session is closed." }],
      }),
    );

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    expect(await screen.findByText("That session is closed.")).toBeInTheDocument();
  });

  it("renders the error envelope for a non-validation failure", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "nope",
        status: 403,
        url: "/class-subjects:clone",
        requestId: "req-3",
      }),
    );

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    expect(await screen.findByText(/You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-3/)).toBeInTheDocument();
  });
});
