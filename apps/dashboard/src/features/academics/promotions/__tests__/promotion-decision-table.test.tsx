import type { PermissionKey } from "@schoolhub/types";
import { badgeVariants, cn } from "@schoolhub/ui";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type PromotionBatchDetail, type PromotionStatus } from "@/services";
import {
  NEXT_CLASS_ID,
  promotionBatchDetail,
  promotionDecision,
  promotionDecisions,
  studentUuid,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import { CLASS_ID } from "@/test-fixtures/academics";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient } from "@/test-utils";

import { PromotionDecisionTable } from "../promotion-decision-table";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    promotions: { updateDecision: jest.fn() },
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

type User = ReturnType<typeof userEvent.setup>;

const UPDATE: PermissionKey = "academics.promotion.update";
const NOT_DRAFT: PromotionStatus[] = ["pending_approval", "approved", "executed", "reverted"];

const ayesha = promotionDecision({ student_name: "Ayesha Khan", admission_number: "ADM-0001" });
const bilal = promotionDecision({
  student_id: studentUuid(2),
  student_name: "Bilal Ahmed",
  admission_number: "ADM-0002",
  to_section_id: null,
  to_section_name: null,
  override_reason: "Strong results, moved up a class.",
  remarks: "Parents agreed.",
});
const zainab = promotionDecision({
  student_id: studentUuid(3),
  student_name: "Zainab Qureshi",
  admission_number: "ADM-0003",
  decision: "retained",
  to_class_id: CLASS_ID,
  to_class_name: "Grade 1",
  to_section_id: null,
  to_section_name: null,
});
const usman = promotionDecision({
  student_id: studentUuid(4),
  student_name: "Usman Ali",
  admission_number: "ADM-0004",
  decision: "graduated",
  to_class_id: null,
  to_class_name: null,
  to_section_id: null,
  to_section_name: null,
});
const FOUR_STUDENTS = [ayesha, bilal, zainab, usman];
const SMALL_BATCH = promotionBatchDetail({ decisions: FOUR_STUDENTS });
const LARGE_BATCH = promotionBatchDetail({ decisions: promotionDecisions(130) });

async function renderTable(batch: PromotionBatchDetail, permissions: PermissionKey[] = []) {
  mockFetchCurrentUser.mockResolvedValue(buildUser(permissions));
  const view = renderWithClient(
    <>
      <PromotionDecisionTable batch={batch} />
      <UserLoaded />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return { ...view, user: userEvent.setup() };
}

function rowOf(name: RegExp) {
  return screen.getByRole("row", { name });
}

/** The body rows: every row but the header's. */
function bodyRowCount() {
  return screen.getAllByRole("row").length - 1;
}

async function goToPage(user: User, page: number) {
  const next = screen.getByRole("button", { name: "Next page" });
  for (let current = 1; current < page; current += 1) {
    await user.click(next);
  }
}

describe("PromotionDecisionTable", () => {
  beforeEach(() => {
    mockFetchCurrentUser.mockReset();
    mockFetchClasses.mockReset().mockResolvedValue([{ id: NEXT_CLASS_ID, name: "Grade 2" }]);
    mockFetchSections.mockReset().mockResolvedValue([]);
  });

  describe("paging", () => {
    it("pages 130 decisions in 13 pages of 10, from the first", async () => {
      await renderTable(LARGE_BATCH);

      expect(screen.getByText("1-10 of 130")).toBeInTheDocument();
      expect(bodyRowCount()).toBe(10);
      expect(screen.getByText("Student 1")).toBeInTheDocument();
      expect(screen.getByText("Student 10")).toBeInTheDocument();
      expect(screen.queryByText("Student 11")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    });

    it("shows rows 121 to 130 on the thirteenth and last page", async () => {
      const { user } = await renderTable(LARGE_BATCH);

      await goToPage(user, 13);

      expect(screen.getByText("121-130 of 130")).toBeInTheDocument();
      expect(bodyRowCount()).toBe(10);
      expect(screen.getByText("Student 121")).toBeInTheDocument();
      expect(screen.getByText("Student 130")).toBeInTheDocument();
      expect(screen.queryByText("Student 120")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go to page 13" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    it("stays on the reviewer's page when the batch is refetched", async () => {
      const { user, rerender } = await renderTable(LARGE_BATCH);
      await goToPage(user, 2);
      expect(screen.getByText("11-20 of 130")).toBeInTheDocument();

      // A refetch hands over new rows (same data, new array), as saving an edit does.
      const refetched = promotionBatchDetail({ decisions: promotionDecisions(130) });
      rerender(<PromotionDecisionTable batch={refetched} />);

      expect(screen.getByText("11-20 of 130")).toBeInTheDocument();
      expect(screen.getByText("Student 11")).toBeInTheDocument();
    });

    it("shows every decision of a small batch on one page", async () => {
      await renderTable(SMALL_BATCH);

      expect(screen.getByText("1-4 of 4")).toBeInTheDocument();
      expect(bodyRowCount()).toBe(4);
    });
  });

  describe("what a row says", () => {
    it("names the student, their admission number and the decision", async () => {
      await renderTable(SMALL_BATCH);

      const row = rowOf(/Ayesha Khan/);
      expect(within(row).getByText("ADM-0001")).toBeInTheDocument();
      expect(within(row).getByText("Promoted")).toBeInTheDocument();
      expect(within(rowOf(/Zainab Qureshi/)).getByText("Retained")).toBeInTheDocument();
      expect(within(rowOf(/Usman Ali/)).getByText("Graduated")).toBeInTheDocument();
    });

    it("shows the target class and section, the override reason and the remarks", async () => {
      await renderTable(SMALL_BATCH);

      const bilalRow = rowOf(/Bilal Ahmed/);
      expect(within(bilalRow).getByText("Grade 2")).toBeInTheDocument();
      expect(within(bilalRow).getByText("Strong results, moved up a class.")).toBeInTheDocument();
      expect(within(bilalRow).getByText("Parents agreed.")).toBeInTheDocument();
      expect(within(rowOf(/Ayesha Khan/)).getByText("A")).toBeInTheDocument();
    });

    it("marks a student who moves on with no target section, as a warning", async () => {
      await renderTable(SMALL_BATCH);

      const marker = within(rowOf(/Bilal Ahmed/)).getByText("Not set");
      expect(marker.className).toBe(cn(badgeVariants({ variant: "warning", appearance: "light" })));
      expect(within(rowOf(/Zainab Qureshi/)).getByText("Not set")).toBeInTheDocument();
      // A section on file, or no section needed: nothing to flag.
      expect(within(rowOf(/Ayesha Khan/)).queryByText("Not set")).not.toBeInTheDocument();
      expect(within(rowOf(/Usman Ali/)).queryByText("Not set")).not.toBeInTheDocument();
    });

    it("gives a graduate's missing class and section a dash that reads as none", async () => {
      await renderTable(promotionBatchDetail({ decisions: [usman] }));

      expect(within(rowOf(/Usman Ali/)).getAllByText("None")).toHaveLength(4);
    });

    it("does not repeat the batch's status in any row: the header owns it", async () => {
      await renderTable(promotionBatchDetail({ status: "draft", decisions: FOUR_STUDENTS }));

      expect(screen.queryByText("Draft")).not.toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    });

    it("says so for a batch with no decisions", async () => {
      await renderTable(promotionBatchDetail({ decisions: [] }));

      expect(screen.getByText("This batch has no decisions")).toBeInTheDocument();
    });
  });

  describe("Edit", () => {
    it("is offered on every row of a draft batch to a viewer who may update it", async () => {
      await renderTable(SMALL_BATCH, [UPDATE]);

      expect(
        screen.getByRole("button", { name: "Edit decision for Ayesha Khan" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /^Edit decision for / })).toHaveLength(4);
    });

    it("is withheld from a viewer without the update key, in a draft too", async () => {
      await renderTable(SMALL_BATCH, []);

      expect(screen.queryByRole("button", { name: /^Edit decision for / })).not.toBeInTheDocument();
    });

    it.each(NOT_DRAFT)("is hidden once the batch is %s", async (status) => {
      await renderTable(promotionBatchDetail({ status, decisions: FOUR_STUDENTS }), [UPDATE]);

      expect(screen.queryByRole("button", { name: /^Edit decision for / })).not.toBeInTheDocument();
    });

    it("opens the editor for that student, and closes it again", async () => {
      const { user } = await renderTable(SMALL_BATCH, [UPDATE]);

      await user.click(screen.getByRole("button", { name: "Edit decision for Bilal Ahmed" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit decision" });
      expect(dialog).toHaveTextContent("Adjusting the draft decision for student Bilal Ahmed.");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("search", () => {
    function searchBox() {
      return screen.getByRole("textbox", { name: "Search students" });
    }

    it("finds a student by name, ignoring case and surrounding space", async () => {
      const { user } = await renderTable(SMALL_BATCH);

      await user.type(searchBox(), "  BIL ");

      expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
      expect(screen.queryByText("Ayesha Khan")).not.toBeInTheDocument();
      expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
    });

    it("finds a student by admission number", async () => {
      const { user } = await renderTable(SMALL_BATCH);

      await user.type(searchBox(), "adm-0003");

      expect(screen.getByText("Zainab Qureshi")).toBeInTheDocument();
      expect(screen.queryByText("Bilal Ahmed")).not.toBeInTheDocument();
    });

    it("says when nobody matches, and shows everyone again once cleared", async () => {
      const { user } = await renderTable(SMALL_BATCH);

      await user.type(searchBox(), "nobody by this name");

      expect(screen.getByText("No students match this search")).toBeInTheDocument();
      expect(screen.queryByText("This batch has no decisions")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(screen.getByText("Ayesha Khan")).toBeInTheDocument();
      expect(screen.queryByText("No students match this search")).not.toBeInTheDocument();
    });

    it("starts again from the first page", async () => {
      const { user } = await renderTable(LARGE_BATCH);
      await goToPage(user, 3);
      expect(screen.getByText("21-30 of 130")).toBeInTheDocument();

      // 42 students have "student 1" in their name: Student 1, 10 to 19 and 100 to 130.
      await user.type(searchBox(), "Student 1");

      expect(screen.getByText("1-10 of 42")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go to page 1" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
});
