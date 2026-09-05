import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloneCurriculumDialog } from "@/features/academics/clone-curriculum-dialog";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));

/** The session list, in a mutable binding so one test can hold it in the
 * `data: undefined` state the dialog paints before the list arrives. */
interface Option {
  id: string;
  name: string;
}
const SESSIONS: Option[] = [
  { id: "sess1", name: "2025-26" },
  { id: "sess2", name: "2026-27" },
  // A third target, so a second clone without closing the dialog can aim
  // somewhere the first one did not.
  { id: "sess3", name: "2027-28" },
];
let mockSessions: { data: Option[] | undefined } = { data: SESSIONS };

jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => mockSessions,
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
    mockSessions = { data: SESSIONS };
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

  it("drops the summary and mints a new idempotency key when the dialog is reopened", async () => {
    mockPost.mockResolvedValue({
      data: { created: 12, skipped: 3 },
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));
    expect(await screen.findByText("12 mappings created, 3 already present.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Clone from another session" }));

    const reopened = screen.getByRole("dialog");
    expect(
      within(reopened).queryByText("12 mappings created, 3 already present."),
    ).not.toBeInTheDocument();
    expect(within(reopened).getByRole("combobox", { name: "Copy from" })).toHaveTextContent(
      "Select a session",
    );

    await user.click(within(reopened).getByRole("combobox", { name: "Copy from" }));
    await user.click(await screen.findByRole("option", { name: "2025-26" }));
    await user.click(within(reopened).getByRole("combobox", { name: "Copy into" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));
    await user.click(within(reopened).getByRole("button", { name: "Clone from another session" }));

    // A reopened dialog is a second intent, not a retry of the first, so it must
    // not replay the first clone's key.
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
    const firstKey = mockPost.mock.calls[0]?.[2]?.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(mockPost.mock.calls[1]?.[2]?.idempotencyKey).not.toBe(firstKey);
  });

  it("mints a new idempotency key for a second clone without closing the dialog", async () => {
    mockPost.mockResolvedValue({
      data: { created: 12, skipped: 3 },
      meta: undefined,
      requestId: null,
      status: 200,
    });

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));
    expect(await screen.findByText("12 mappings created, 3 already present.")).toBeInTheDocument();

    // Same dialog, different target. The server replays strictly on
    // (tenant, key, endpoint) with no body hash, so reusing the first key here
    // would return the first clone's counts and copy nothing into 2027-28 —
    // silently, with a success message naming rows it never wrote.
    await user.click(within(dialog).getByRole("combobox", { name: "Copy into" }));
    await user.click(await screen.findByRole("option", { name: "2027-28" }));
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
    const firstKey = mockPost.mock.calls[0]?.[2]?.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(mockPost.mock.calls[1]?.[2]?.idempotencyKey).not.toBe(firstKey);
  });

  it("offers no sessions to clone between while the session list is still loading", async () => {
    mockSessions = { data: undefined };
    const user = userEvent.setup();

    renderWithProviders(<CloneCurriculumDialog />);
    await user.click(screen.getByRole("button", { name: "Clone from another session" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Copy into" })).toHaveTextContent(
      "Select a session",
    );

    await user.click(within(dialog).getByRole("combobox", { name: "Copy from" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows no message at all when the client rejects with something that is not an ApiError", async () => {
    mockPost.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user, dialog } = await openAndPick("2025-26", "2026-27");
    await user.click(within(dialog).getByRole("button", { name: "Clone from another session" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });
    // Only the API envelope has anything to say here, so a non-ApiError rejection
    // leaves the dialog open and unannotated rather than showing a raw message.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
