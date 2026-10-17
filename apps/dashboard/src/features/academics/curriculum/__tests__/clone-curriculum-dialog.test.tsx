import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  CLOSED_SESSION_ID,
  PLANNED_SESSION_ID,
  SESSION_ID,
  SESSIONS,
} from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { renderWithProviders } from "@/test-utils";

import { CloneCurriculumDialog, type CloneCurriculumDialogProps } from "../clone-curriculum-dialog";

// The result surfaces as a toast, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { curriculum: { cloneCurriculum: jest.fn() } },
}));

const mockCloneCurriculum = Services.curriculum.cloneCurriculum as jest.MockedFunction<
  typeof Services.curriculum.cloneCurriculum
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

type User = ReturnType<typeof userEvent.setup>;

const RESULT = { created: 12, skipped: 3 };

function renderClone(overrides: Partial<CloneCurriculumDialogProps> = {}) {
  const props: CloneCurriculumDialogProps = {
    open: true,
    onOpenChange: jest.fn(),
    sessions: SESSIONS,
    currentSessionId: SESSION_ID,
    onSwitchSession: jest.fn(),
    ...overrides,
  };
  const view = renderWithProviders(<CloneCurriculumDialog {...props} />);
  return { ...view, ...props, user: userEvent.setup() };
}

async function pick(user: User, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** A 422 from the clone endpoint; `details` name the fields the server rejected. */
function unprocessable(details: { field: string; issue: string }[] = []) {
  return new ApiError({
    code: "unprocessable",
    message: "Rejected.",
    status: 422,
    url: "/class-subjects:clone",
    details,
  });
}

function submit(user: User) {
  return user.click(screen.getByRole("button", { name: "Clone" }));
}

describe("CloneCurriculumDialog", () => {
  beforeEach(() => {
    mockCloneCurriculum.mockReset().mockResolvedValue(RESULT);
    mockToastSuccess.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("copies from any session but the target, and into a session that isn't locked", async () => {
    const { user } = renderClone();

    const target = screen.getByRole("combobox", { name: "Copy into" });
    await waitFor(() => {
      expect(target).toHaveTextContent("2026-27");
    });

    await user.click(screen.getByRole("combobox", { name: "Copy from" }));
    expect(await screen.findByRole("option", { name: "2027-28" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2025-26" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "2026-27" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "2025-26" }));

    await user.click(target);
    expect(await screen.findByRole("option", { name: "2026-27" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2027-28" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "2025-26" })).not.toBeInTheDocument();
  });

  it("clears the source when the target moves onto it", async () => {
    const { user } = renderClone();

    await pick(user, "Copy from", "2027-28");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Copy from" })).toHaveTextContent("2027-28");
    });
    await pick(user, "Copy into", "2027-28");

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Copy from" })).toHaveTextContent(
        "Select a session",
      );
    });
  });

  it("asks for the source session, and sends nothing without it", async () => {
    const { user } = renderClone();

    await submit(user);

    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(mockCloneCurriculum).not.toHaveBeenCalled();
  });

  it("reuses one idempotency key when a retry follows a failure in the same dialog", async () => {
    const keys: string[] = [];
    mockCloneCurriculum.mockImplementation((_source, _target, key) => {
      keys.push(key);
      return keys.length === 1 ? Promise.reject(unprocessable()) : Promise.resolve(RESULT);
    });
    const { onOpenChange, user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await submit(user);
    expect(await screen.findByText("That request could not be completed.")).toBeInTheDocument();
    await submit(user);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("sends a new key for a changed source, and the first again when changed back", async () => {
    const keys: string[] = [];
    mockCloneCurriculum.mockImplementation((_source, _target, key) => {
      keys.push(key);
      const issue = `Refused ${keys.length}.`;
      return keys.length < 3
        ? Promise.reject(unprocessable([{ field: "target_academic_session_id", issue }]))
        : Promise.resolve(RESULT);
    });
    const { onOpenChange, user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await submit(user);
    expect(await screen.findByText("Refused 1.")).toBeInTheDocument();
    await pick(user, "Copy from", "2027-28");
    await submit(user);
    expect(await screen.findByText("Refused 2.")).toBeInTheDocument();
    await pick(user, "Copy from", "2025-26");
    await submit(user);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(keys).toHaveLength(3);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it("gives a dialog opened later a key of its own", async () => {
    const keys: string[] = [];
    mockCloneCurriculum.mockImplementation((_source, _target, key) => {
      keys.push(key);
      return Promise.resolve(RESULT);
    });

    const first = renderClone();
    await pick(first.user, "Copy from", "2025-26");
    await submit(first.user);
    await waitFor(() => {
      expect(keys).toHaveLength(1);
    });
    first.unmount();

    const second = renderClone();
    await pick(second.user, "Copy from", "2025-26");
    await submit(second.user);
    await waitFor(() => {
      expect(keys).toHaveLength(2);
    });

    expect(keys[1]).not.toBe(keys[0]);
  });

  it("toasts how many were created and skipped, then refreshes and switches to the target", async () => {
    const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
    const { onOpenChange, onSwitchSession, user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await pick(user, "Copy into", "2027-28");
    await submit(user);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("12 mappings created, 3 already present.");
    });
    expect(mockCloneCurriculum).toHaveBeenCalledWith(
      CLOSED_SESSION_ID,
      PLANNED_SESSION_ID,
      expect.any(String),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["curriculum"] });
    expect(onSwitchSession).toHaveBeenCalledWith(PLANNED_SESSION_ID);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays on the screen's session when it cloned into it", async () => {
    const { onOpenChange, onSwitchSession, user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await submit(user);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockCloneCurriculum).toHaveBeenCalledWith(
      CLOSED_SESSION_ID,
      SESSION_ID,
      expect.any(String),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("12 mappings created, 3 already present.");
    expect(onSwitchSession).not.toHaveBeenCalled();
  });

  it("shows a 422 inline and stays open", async () => {
    const issue = "Academic session '2026-27' is closed and cannot be modified.";
    mockCloneCurriculum.mockRejectedValue(
      unprocessable([{ field: "target_academic_session_id", issue }]),
    );
    const { onOpenChange, onSwitchSession, user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await submit(user);

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSwitchSession).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a failure that isn't an API error", async () => {
    mockCloneCurriculum.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = renderClone();

    await pick(user, "Copy from", "2025-26");
    await submit(user);

    const message = await screen.findByText("Something went wrong. Please try again.");
    expect(message).toBeInTheDocument();
  });

  it("closes without cloning on Cancel", async () => {
    const { onOpenChange, user } = renderClone();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockCloneCurriculum).not.toHaveBeenCalled();
  });
});
