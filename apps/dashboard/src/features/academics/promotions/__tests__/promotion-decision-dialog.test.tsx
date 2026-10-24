import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { queryKeys } from "@/lib/query-client";
import { Services, type PromotionDecisionRecord } from "@/services";
import {
  BATCH_ID,
  FAR_CLASS_ID,
  NEXT_CLASS_ID,
  NEXT_SECTION_ID,
  OTHER_SECTION_ID,
  promotionDecision,
  refusal,
  studentUuid,
  unprocessable,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import {
  PROMOTION_BATCH_RESOURCE,
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";
import { CLASS_ID } from "@/test-fixtures/academics";
import { renderWithClient } from "@/test-utils";

import { PromotionDecisionDialog } from "../promotion-decision-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    promotions: { updateDecision: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
  },
}));

const mockUpdate = Services.promotions.updateDecision as jest.MockedFunction<
  typeof Services.promotions.updateDecision
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

type User = ReturnType<typeof userEvent.setup>;

const DETAIL_KEY = queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, BATCH_ID);
const LIST_KEY = queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE);
const BARE_KEY = queryKeys.module(PROMOTION_QUERY_MODULE);

const CLASSES = [
  { id: CLASS_ID, name: "Grade 1" },
  { id: NEXT_CLASS_ID, name: "Grade 2" },
  { id: FAR_CLASS_ID, name: "Grade 3" },
];
const SECTIONS: Record<string, { id: string; name: string; campus_id: string }[]> = {
  [NEXT_CLASS_ID]: [{ id: NEXT_SECTION_ID, name: "A", campus_id: "campus-1" }],
  [FAR_CLASS_ID]: [{ id: OTHER_SECTION_ID, name: "B", campus_id: "campus-1" }],
};

/** The row's student: Ayesha Khan, in the shared decision fixture. */
const STUDENT_ID = studentUuid(1);
const REQUIRED = "This field is required.";
const SECTION_HINT = /Required before the batch can be executed/;

function sectionsOf(classId: string) {
  return Promise.resolve(SECTIONS[classId] ?? []);
}

async function renderDialog(overrides: Partial<PromotionDecisionRecord> = {}) {
  const onOpenChange = jest.fn();
  const view = renderWithClient(
    <PromotionDecisionDialog
      open
      onOpenChange={onOpenChange}
      batchId={BATCH_ID}
      decision={promotionDecision(overrides)}
    />,
  );
  const invalidate = jest.spyOn(view.queryClient, "invalidateQueries");
  await screen.findByRole("dialog", { name: "Edit decision" });
  return { ...view, invalidate, onOpenChange, user: userEvent.setup() };
}

function field(name: string) {
  return screen.getByRole("combobox", { name });
}

function textField(name: string) {
  return screen.getByRole("textbox", { name });
}

async function pick(user: User, name: string, option: string) {
  await user.click(field(name));
  await user.click(await screen.findByRole("option", { name: option }));
}

function save(user: User) {
  return user.click(screen.getByRole("button", { name: "Save" }));
}

describe("PromotionDecisionDialog", () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue(promotionDecision());
    mockFetchClasses.mockReset().mockResolvedValue(CLASSES);
    mockFetchSections.mockReset().mockImplementation(({ classId }) => sectionsOf(classId));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what it opens with", () => {
    it("shows the row's decision, targets and notes", async () => {
      await renderDialog({ override_reason: "Moved up a class.", remarks: "Parents agreed." });

      expect(field("Decision")).toHaveTextContent("Promoted");
      expect(field("Target class")).toHaveTextContent("Grade 2");
      expect(field("Target section")).toHaveTextContent(/^A$/);
      expect(textField("Override reason")).toHaveValue("Moved up a class.");
      expect(textField("Remarks")).toHaveValue("Parents agreed.");
      const intro = /Adjusting the draft decision for student Ayesha Khan/;
      expect(screen.getByText(intro)).toBeInTheDocument();
    });

    it("explains that a section is needed before execution, unless graduating", async () => {
      await renderDialog();

      expect(screen.getByText(SECTION_HINT)).toBeInTheDocument();
    });

    it("opens a graduating student's class and section disabled and empty", async () => {
      await renderDialog({
        decision: "graduated",
        to_class_id: null,
        to_class_name: null,
        to_section_id: null,
        to_section_name: null,
      });

      expect(field("Target class")).toBeDisabled();
      expect(field("Target section")).toBeDisabled();
      expect(screen.queryByText(SECTION_HINT)).not.toBeInTheDocument();
    });

    it("still shows a class that is no longer offered, when the row points at it", async () => {
      mockFetchClasses.mockResolvedValue([{ id: FAR_CLASS_ID, name: "Grade 3" }]);
      const { user } = await renderDialog();

      expect(field("Target class")).toHaveTextContent("Grade 2");
      await pick(user, "Decision", "Retained");
      expect(field("Target class")).toHaveTextContent("Grade 1");
    });
  });

  describe("the rules it mirrors", () => {
    it("clears and disables class and section for graduating, sending null", async () => {
      const { user } = await renderDialog();

      await pick(user, "Decision", "Graduated");

      expect(field("Target class")).toBeDisabled();
      expect(field("Target class")).toHaveTextContent("Select a class");
      expect(field("Target section")).toBeDisabled();
      expect(field("Target section")).toHaveTextContent("Select a section");
      await save(user);
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, {
        decision: "graduated",
        toClassId: null,
        toSectionId: null,
      });
    });

    it("fixes the class to the student's own for retaining", async () => {
      const { user } = await renderDialog();

      await pick(user, "Decision", "Retained");

      expect(field("Target class")).toBeDisabled();
      expect(field("Target class")).toHaveTextContent("Grade 1");
      // A section belongs to its class: the Grade 2 one no longer applies.
      expect(field("Target section")).toBeEnabled();
      expect(field("Target section")).toHaveTextContent("Select a section");
      await save(user);
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, {
        decision: "retained",
        toClassId: CLASS_ID,
        toSectionId: null,
      });
    });

    it("offers the sections of the class picked, and clears the one it had", async () => {
      const { user } = await renderDialog();

      await pick(user, "Target class", "Grade 3");

      expect(field("Target section")).toHaveTextContent("Select a section");
      await user.click(field("Target section"));
      // Grade 3's sections only: Grade 2's section A is not one of them.
      expect(await screen.findByRole("option", { name: "B" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "A" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("option", { name: "B" }));
      await save(user);
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, {
        toClassId: FAR_CLASS_ID,
        toSectionId: OTHER_SECTION_ID,
      });
    });

    it("clears a wrong section with None, sending null, and keeps the class", async () => {
      const { user } = await renderDialog();

      await pick(user, "Target section", "None");

      expect(field("Target section")).toHaveTextContent("Select a section");
      await save(user);
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, { toSectionId: null });
    });

    it("offers None only while a section is set", async () => {
      const { user } = await renderDialog({ to_section_id: null, to_section_name: null });

      await user.click(field("Target section"));

      expect(await screen.findByRole("option", { name: "A" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "None" })).not.toBeInTheDocument();
    });

    it("needs a class for any decision but graduating, and sends nothing without one", async () => {
      const { user } = await renderDialog({
        decision: "graduated",
        to_class_id: null,
        to_class_name: null,
        to_section_id: null,
        to_section_name: null,
        decision_basis: { proposed_decision: "graduated", proposed_to_class_id: null },
      });

      await pick(user, "Decision", "Promoted");
      expect(field("Target class")).toBeEnabled();
      await save(user);

      await waitFor(() => {
        expect(field("Target class")).toHaveAccessibleDescription(REQUIRED);
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("the override reason", () => {
    it("is marked required where the decision differs from the proposal", async () => {
      const { user } = await renderDialog();
      expect(textField("Override reason")).not.toHaveAttribute("aria-required");

      await pick(user, "Decision", "Promoted on trial");

      expect(textField("Override reason")).toHaveAttribute("aria-required", "true");
    });

    it("is marked required where the class differs, not once back to the proposal", async () => {
      const { user } = await renderDialog();

      await pick(user, "Target class", "Grade 3");
      expect(textField("Override reason")).toHaveAttribute("aria-required", "true");
      await pick(user, "Target class", "Grade 2");

      expect(textField("Override reason")).not.toHaveAttribute("aria-required");
    });

    it("is required for retaining even with no recorded proposal, as the server asks", async () => {
      const { user } = await renderDialog({ decision_basis: null });

      await pick(user, "Decision", "Retained");

      expect(textField("Override reason")).toHaveAttribute("aria-required", "true");
    });

    it("claims nothing else for a row with no recorded proposal", async () => {
      const { user } = await renderDialog({ decision_basis: null });

      await pick(user, "Decision", "Graduated");

      expect(textField("Override reason")).not.toHaveAttribute("aria-required");
    });

    it("never blocks saving: the server asks for it when the batch is submitted", async () => {
      const { user, onOpenChange } = await renderDialog();
      await pick(user, "Decision", "Promoted on trial");

      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, {
        decision: "promoted_on_trial",
      });
    });
  });

  describe("saving", () => {
    it("sends only what changed", async () => {
      const { user } = await renderDialog();

      await user.type(textField("Remarks"), "Needs a second look");
      await save(user);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, {
        remarks: "Needs a second look",
      });
    });

    it("sends an emptied note as null, which clears it", async () => {
      const { user } = await renderDialog({ remarks: "Parents agreed." });

      await user.clear(textField("Remarks"));
      await save(user);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdate).toHaveBeenCalledWith(BATCH_ID, STUDENT_ID, { remarks: null });
    });

    it("closes without a request, or a refresh, when nothing changed", async () => {
      const { user, onOpenChange, invalidate } = await renderDialog();

      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("refreshes the batch's detail, and nothing else, once saved", async () => {
      const { user, onOpenChange, invalidate } = await renderDialog();

      await user.type(textField("Remarks"), "Note");
      await save(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BARE_KEY });
    });
  });

  describe("when the server refuses", () => {
    const issue = "A target class is required unless the student is graduating.";

    it("puts a 400 on the field it names, and keeps the dialog open", async () => {
      mockUpdate.mockRejectedValue(refusal(400, "validation_error", "to_class_id", issue));
      const { user, onOpenChange, invalidate } = await renderDialog();

      await user.type(textField("Remarks"), "Note");
      await save(user);

      await waitFor(() => {
        expect(field("Target class")).toHaveAccessibleDescription(issue);
      });
      // The one alert is the field's own: nothing was folded into the form's message.
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("puts a 422 on the override reason under that field", async () => {
      const reason = "An override reason is required where the decision differs.";
      mockUpdate.mockRejectedValue(unprocessable("override_reason", reason));
      const { user } = await renderDialog();

      await user.type(textField("Remarks"), "Note");
      await save(user);

      await waitFor(() => {
        expect(textField("Override reason")).toHaveAccessibleDescription(reason);
      });
    });

    it("shows a refusal about no input above the form", async () => {
      const message = "This batch is no longer a draft.";
      mockUpdate.mockRejectedValue(unprocessable("status", message));
      const { user, onOpenChange } = await renderDialog();

      await user.type(textField("Remarks"), "Note");
      await save(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("shows a status race inline and reloads the batch to show its real status", async () => {
      const message = "This batch changed while the action was running.";
      mockUpdate.mockRejectedValue(refusal(409, "conflict", "non_field", message));
      const { user, onOpenChange, invalidate } = await renderDialog();

      await user.type(textField("Remarks"), "Note");
      await save(user);

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
  });
});
