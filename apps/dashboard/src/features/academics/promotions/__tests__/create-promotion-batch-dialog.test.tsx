import { ApiError } from "@schoolhub/api-client";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import {
  BATCH_ID,
  NEXT_CLASS_ID,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import {
  CLASS_ID,
  CLOSED_SESSION_ID,
  PLANNED_SESSION_ID,
  SESSION_ID,
  SESSIONS,
} from "@/test-fixtures/academics";
import { renderWithProviders } from "@/test-utils";

import {
  CreatePromotionBatchDialog,
  type CreatePromotionBatchDialogProps,
} from "../create-promotion-batch-dialog";

// The router is this file's own so the navigation after a create can be asserted.
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

// A created batch toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    promotions: { createPromotionBatch: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn() },
  },
}));

const mockCreateBatch = Services.promotions.createPromotionBatch as jest.MockedFunction<
  typeof Services.promotions.createPromotionBatch
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

type User = ReturnType<typeof userEvent.setup>;

const CREATED = { batch_id: BATCH_ID, students: 24 };

function renderDialog(overrides: Partial<CreatePromotionBatchDialogProps> = {}) {
  const props: CreatePromotionBatchDialogProps = {
    open: true,
    onOpenChange: jest.fn(),
    sessions: SESSIONS,
    currentSessionId: SESSION_ID,
    ...overrides,
  };
  const view = renderWithProviders(<CreatePromotionBatchDialog {...props} />);
  return { ...view, ...props, user: userEvent.setup() };
}

async function pick(user: User, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

/** The choices that make a batch the server would accept: 2027-28 as the target, Grade 1. */
async function fillIn(user: User) {
  await pick(user, "To session", "2027-28");
  await pick(user, "Class", "Grade 1");
}

function submit(user: User) {
  return user.click(screen.getByRole("button", { name: "Create batch" }));
}

/** What the API answers for a refused create: the HTTP status, and where the reason belongs. */
function refused(status: 409 | 422, field: string, issue: string) {
  return new ApiError({
    code: status === 409 ? "conflict" : "domain_rule_violation",
    message: issue,
    status,
    url: "/student-promotions",
    details: [{ field, issue }],
  });
}

describe("CreatePromotionBatchDialog", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCreateBatch.mockReset().mockResolvedValue(CREATED);
    mockToastSuccess.mockReset();
    mockFetchClasses.mockReset().mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
      { id: NEXT_CLASS_ID, name: "Grade 2" },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the choices", () => {
    it("starts on the current session as the source, with the rest to pick", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "From session" })).toHaveTextContent("2026-27");
      });
      expect(screen.getByRole("combobox", { name: "To session" })).toHaveTextContent(
        "Select a session",
      );
      expect(screen.getByRole("combobox", { name: "Class" })).toHaveTextContent("Select a class");
    });

    it("starts with no source when no session is current", async () => {
      renderDialog({ currentSessionId: "" });

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "From session" })).toHaveTextContent(
          "Select a session",
        );
      });
    });

    it("offers every session as the source, a closed one included", async () => {
      const { user } = renderDialog();

      await user.click(screen.getByRole("combobox", { name: "From session" }));

      expect(await screen.findByRole("option", { name: "2026-27" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "2027-28" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "2025-26" })).toBeInTheDocument();
    });

    it("offers as the target neither the source nor a closed session", async () => {
      const { user } = renderDialog();

      await user.click(screen.getByRole("combobox", { name: "To session" }));

      expect(await screen.findByRole("option", { name: "2027-28" })).toBeInTheDocument();
      // 2026-27 is the source and 2025-26 is closed (read-only): the server would refuse both.
      expect(screen.queryByRole("option", { name: "2026-27" })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "2025-26" })).not.toBeInTheDocument();
    });

    it("offers the old source as a target once the source moves", async () => {
      const { user } = renderDialog();

      await pick(user, "From session", "2027-28");
      await user.click(screen.getByRole("combobox", { name: "To session" }));

      expect(await screen.findByRole("option", { name: "2026-27" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "2027-28" })).not.toBeInTheDocument();
    });

    it("clears the target when the source moves onto it", async () => {
      const { user } = renderDialog();

      await pick(user, "To session", "2027-28");
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "To session" })).toHaveTextContent("2027-28");
      });
      await pick(user, "From session", "2027-28");

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "To session" })).toHaveTextContent(
          "Select a session",
        );
      });
    });

    it("asks for only the classes still offered", async () => {
      renderDialog();

      await waitFor(() => {
        expect(mockFetchClasses).toHaveBeenCalledWith({ isActive: true });
      });
      expect(mockFetchClasses).toHaveBeenCalledTimes(1);
    });
  });

  describe("creating", () => {
    it("sends the picked sessions and class, then opens the new batch", async () => {
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(`/academics/promotions/${BATCH_ID}`);
      });
      expect(mockCreateBatch).toHaveBeenCalledTimes(1);
      expect(mockCreateBatch).toHaveBeenCalledWith({
        fromAcademicSessionId: SESSION_ID,
        toAcademicSessionId: PLANNED_SESSION_ID,
        classId: CLASS_ID,
      });
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("sends the source the user picked, not the one it started on", async () => {
      const { user } = renderDialog();

      await pick(user, "From session", "2025-26");
      await fillIn(user);
      await submit(user);

      await waitFor(() => {
        expect(mockCreateBatch).toHaveBeenCalledWith({
          fromAcademicSessionId: CLOSED_SESSION_ID,
          toAcademicSessionId: PLANNED_SESSION_ID,
          classId: CLASS_ID,
        });
      });
    });

    it.each([
      [24, "Promotion batch created with 24 students."],
      [1, "Promotion batch created with 1 student."],
    ])("toasts a batch of %i students as %p", async (students, message) => {
      mockCreateBatch.mockResolvedValue({ batch_id: BATCH_ID, students });
      const { user } = renderDialog();

      await fillIn(user);
      await submit(user);

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(message);
      });
    });

    it("refreshes the batch list, and never the bare promotions key", async () => {
      // The bare key also matches a running execute job's poll, which would refetch it.
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      const { user } = renderDialog();

      await fillIn(user);
      await submit(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled();
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["promotions", "batches", "list", {}],
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["promotions"] });
    });

    it("asks for the session and class that are missing, and sends nothing", async () => {
      const { user } = renderDialog();

      await submit(user);

      // The source is defaulted; the target and the class are not.
      expect(await screen.findAllByText("This field is required.")).toHaveLength(2);
      expect(mockCreateBatch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("asks for the source when none is current, and sends nothing", async () => {
      const { user } = renderDialog({ currentSessionId: "" });

      await pick(user, "To session", "2027-28");
      await pick(user, "Class", "Grade 1");
      await submit(user);

      expect(await screen.findByText("This field is required.")).toBeInTheDocument();
      expect(mockCreateBatch).not.toHaveBeenCalled();
    });

    it("closes on Cancel without creating anything", async () => {
      const { onOpenChange, user } = renderDialog();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockCreateBatch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("a refusal", () => {
    it("shows a 409 (the batch exists) above the form, and stays open", async () => {
      const issue = "A promotion batch already exists for this class and session pair.";
      mockCreateBatch.mockRejectedValue(refused(409, "non_field", issue));
      const invalidateSpy = jest.spyOn(QueryClient.prototype, "invalidateQueries");
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "New promotion batch" })).toBeInTheDocument();
    });

    it("shows a 422 about the class under the class, and stays open", async () => {
      const issue = "No actively enrolled students in this class for that session.";
      mockCreateBatch.mockRejectedValue(refused(422, "class_id", issue));
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("shows a 422 about the target session under it, and stays open", async () => {
      const issue = "The target session must differ from the source.";
      mockCreateBatch.mockRejectedValue(refused(422, "to_academic_session_id", issue));
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("shows a 422 that names no field above the form, and stays open", async () => {
      const issue = "Academic session '2027-28' is closed and cannot be modified.";
      mockCreateBatch.mockRejectedValue(refused(422, "non_field", issue));
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("keeps what was picked, so a retry after a refusal needs no re-picking", async () => {
      const issue = "A promotion batch already exists for this class and session pair.";
      mockCreateBatch
        .mockRejectedValueOnce(refused(409, "non_field", issue))
        .mockResolvedValueOnce(CREATED);
      const { user } = renderDialog();

      await fillIn(user);
      await submit(user);
      expect(await screen.findByText(issue)).toBeInTheDocument();
      await submit(user);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(`/academics/promotions/${BATCH_ID}`);
      });
      expect(mockCreateBatch).toHaveBeenCalledTimes(2);
      expect(mockCreateBatch).toHaveBeenLastCalledWith({
        fromAcademicSessionId: SESSION_ID,
        toAcademicSessionId: PLANNED_SESSION_ID,
        classId: CLASS_ID,
      });
      expect(screen.queryByText(issue)).not.toBeInTheDocument();
    });

    it("falls back to a generic message for a failure that isn't an API error", async () => {
      mockCreateBatch.mockRejectedValue(new TypeError("Failed to fetch"));
      const { onOpenChange, user } = renderDialog();

      await fillIn(user);
      await submit(user);

      expect(
        await screen.findByText("Something went wrong. Please try again."),
      ).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });
});
