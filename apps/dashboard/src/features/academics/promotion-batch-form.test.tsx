import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromotionBatchForm } from "@/features/academics/promotion-batch-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

/** The reference lists, held in mutable bindings so one test can put them back
 * into the `data: undefined` state every screen paints before they arrive. */
interface Option {
  id: string;
  name: string;
}
const SESSIONS: Option[] = [
  { id: "sess1", name: "2025-26" },
  { id: "sess2", name: "2026-27" },
];
const CLASSES: Option[] = [{ id: "class1", name: "Grade 8" }];
let mockSessions: { data: Option[] | undefined } = { data: SESSIONS };
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };

jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => mockSessions,
  useClasses: () => mockClasses,
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

async function openAndFill(from = "2025-26", to = "2026-27") {
  const user = userEvent.setup();
  renderWithProviders(<PromotionBatchForm />);
  await user.click(screen.getByRole("button", { name: "New batch" }));

  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "From session" }));
  await user.click(await screen.findByRole("option", { name: from }));
  await user.click(within(dialog).getByRole("combobox", { name: "To session" }));
  await user.click(await screen.findByRole("option", { name: to }));
  await user.click(within(dialog).getByRole("combobox", { name: "Class" }));
  await user.click(await screen.findByRole("option", { name: "Grade 8" }));

  return { user, dialog };
}

describe("PromotionBatchForm", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPush.mockReset();
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
  });

  it("creates a batch and navigates to its review table", async () => {
    mockPost.mockResolvedValue({
      data: { batch_id: "batch-1", students: 30 },
      meta: undefined,
      requestId: null,
      status: 201,
    });

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-promotions", {
        from_academic_session_id: "sess1",
        to_academic_session_id: "sess2",
        class_id: "class1",
      });
    });
    expect(mockPush).toHaveBeenCalledWith("/academics/promotions/batch-1");
  });

  it("refuses a batch whose target session is the source", async () => {
    const { user, dialog } = await openAndFill("2025-26", "2025-26");
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    expect(
      await screen.findByText("The target session must differ from the source."),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("puts a server field error on the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/student-promotions",
        details: [{ field: "class_id", issue: "No actively enrolled students in this class." }],
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    expect(
      await screen.findByText("No actively enrolled students in this class."),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("routes a field with no control into the root message", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/student-promotions",
        details: [{ field: "non_field", issue: "That session is closed." }],
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    expect(await screen.findByText("That session is closed.")).toBeInTheDocument();
  });

  it("renders the error envelope for a conflict", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "A promotion batch already exists.",
        status: 409,
        url: "/student-promotions",
        requestId: "req-6",
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-6/)).toBeInTheDocument();
  });

  it("empties the picked sessions and class when the dialog is dismissed", async () => {
    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "New batch" }));

    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByRole("combobox", { name: "From session" })).toHaveTextContent(
      "Select a session",
    );
    expect(within(reopened).getByRole("combobox", { name: "To session" })).toHaveTextContent(
      "Select a session",
    );
    expect(within(reopened).getByRole("combobox", { name: "Class" })).toHaveTextContent(
      "Select a class",
    );
  });

  it("offers no options while the session and class lists are still loading", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchForm />);
    await user.click(screen.getByRole("button", { name: "New batch" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Class" })).toHaveTextContent(
      "Select a class",
    );

    await user.click(within(dialog).getByRole("combobox", { name: "From session" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows no message at all when the client rejects with something that is not an ApiError", async () => {
    mockPost.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "New batch" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });
    // The envelope is the only thing this form knows how to render, so a
    // non-ApiError rejection leaves the dialog open and unannotated.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
