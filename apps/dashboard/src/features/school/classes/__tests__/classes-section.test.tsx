import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  classRecord,
  sectionRecord,
  structurePage,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { CAMPUS_ID, CLASS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { ClassesSection } from "../classes-section";

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
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: {
      fetchClasses: jest.fn(),
      fetchClassPage: jest.fn(),
      createClass: jest.fn(),
      updateClass: jest.fn(),
      deleteClass: jest.fn(),
      fetchClassSections: jest.fn(),
      createSection: jest.fn(),
      updateSection: jest.fn(),
      deleteSection: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

const STRUCTURE_KEYS: PermissionKey[] = [
  "school.class.view",
  "school.class.create",
  "school.class.update",
  "school.class.delete",
  "school.section.view",
  "school.section.create",
  "school.section.update",
  "school.section.delete",
];

const GRADE_10_ID = "0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b";
const grade1 = classRecord();
const grade10 = classRecord({ id: GRADE_10_ID, name: "Grade 10", code: "G10", level: 10 });
const retired = classRecord({
  id: "1f2a3b4c-5d6e-4f7a-9b8c-9d0e1f2a3b4c",
  name: "Prep",
  code: null,
  level: 11,
  is_active: false,
});

/** What `ClassSerializer.validate_level` answers for a level another live class holds. */
const LEVEL_TAKEN = "Level 1 is already used by class 'Grade 1'.";

const OLD_CAMPUS_ID = "3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e";

/** `services.assert_deletable`'s 422, naming the relations that still point at the row. */
function referenced(relations: string[], url: string) {
  const message =
    `Cannot delete while dependent records exist (${relations.join(", ")}). ` +
    "Deactivate it instead.";
  return new ApiError({
    code: "domain_rule_violation",
    message,
    status: 422,
    url,
    details: [{ field: "non_field", issue: message }],
  });
}

function renderSection() {
  renderWithProviders(<ClassesSection />);
  return userEvent.setup();
}

describe("classes section", () => {
  beforeEach(() => {
    setUrl("/school/classes");
    mockFetchCurrentUser.mockReset().mockResolvedValue(buildUser(STRUCTURE_KEYS));
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
    so.fetchClassPage.mockReset().mockResolvedValue(structurePage([grade1, grade10, retired]));
    // The API's own `is_active` filter: a picker asks for the live classes only.
    so.fetchClasses
      .mockReset()
      .mockImplementation(({ isActive } = {}) =>
        Promise.resolve(
          [grade1, grade10, retired]
            .filter((row) => isActive === undefined || row.is_active === isActive)
            .map(({ id, name }) => ({ id, name })),
        ),
      );
    so.fetchClassSections.mockReset().mockResolvedValue([sectionRecord()]);
    for (const write of [
      so.createClass,
      so.updateClass,
      so.deleteClass,
      so.createSection,
      so.updateSection,
      so.deleteSection,
    ]) {
      write.mockReset();
    }
  });

  it("lists the classes up the promotion ladder, each with its level and status", async () => {
    renderSection();

    const row = await screen.findByRole("row", { name: /Grade 10/ });
    expect(within(row).getByText("10")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Prep/ })).getByText("Inactive"),
    ).toBeInTheDocument();
    expect(so.fetchClassPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, ordering: "level" }),
    );
  });

  it("opens a class onto its sections, each with its campus and seats", async () => {
    so.fetchClassSections.mockResolvedValue([
      sectionRecord(),
      sectionRecord({
        id: "2a3b4c5d-6e7f-4a8b-8c9d-0e1f2a3b4c5d",
        name: "B",
        capacity: null,
        is_active: false,
      }),
    ]);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));

    const sections = await screen.findByRole("table", { name: "Sections of Grade 1" });
    const sectionA = within(sections).getByRole("row", { name: /^A / });
    expect(within(sectionA).getByText("Main Campus")).toBeInTheDocument();
    expect(within(sectionA).getByText("30")).toBeInTheDocument();
    const sectionB = within(sections).getByRole("row", { name: /^B / });
    expect(within(sectionB).getByText("Unlimited")).toBeInTheDocument();
    expect(within(sectionB).getByText("Inactive")).toBeInTheDocument();
    expect(so.fetchClassSections).toHaveBeenCalledWith(CLASS_ID);
  });

  it("hides an inactive class from the section form's class picker", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog");
    // The section starts in the class it was added from.
    const classPicker = within(dialog).getByRole("combobox", { name: "Class" });
    await waitFor(() => {
      expect(classPicker).toHaveTextContent("Grade 1");
    });
    await user.click(classPicker);

    expect(await screen.findByRole("option", { name: "Grade 10" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Prep" })).not.toBeInTheDocument();
    expect(so.fetchClasses).toHaveBeenCalledWith({ isActive: true });
  });

  it("adds a section on a campus, a blank capacity meaning unlimited", async () => {
    so.createSection.mockResolvedValue(sectionRecord({ name: "C" }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "C");
    await user.click(within(dialog).getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createSection).toHaveBeenCalledWith({
        class_id: CLASS_ID,
        campus_id: CAMPUS_ID,
        name: "C",
        capacity: null,
        is_active: true,
      });
    });
    expect(mockFetchCampuses).toHaveBeenCalledWith({ isActive: true });
  });

  it("asks for a campus before sending a section", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Add section" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "C");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(so.createSection).not.toHaveBeenCalled();
  });

  it("shows a level another class already holds under the level field", async () => {
    so.createClass.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: LEVEL_TAKEN,
        status: 400,
        url: "/classes",
        details: [{ field: "level", issue: LEVEL_TAKEN }],
      }),
    );
    const user = renderSection();

    // The row's Edit means the viewer's keys are known, so Add is enabled.
    await screen.findByRole("button", { name: "Edit Grade 1" });
    await user.click(screen.getByRole("button", { name: "Add class" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Grade One");
    const level = within(dialog).getByLabelText("Level");
    await user.type(level, "1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const message = await within(dialog).findByText(LEVEL_TAKEN);
    // Under the level input, as its own description, not the form's message.
    expect(level).toHaveAttribute("aria-invalid", "true");
    expect(level.getAttribute("aria-describedby")).toContain(message.id);
    expect(so.createClass).toHaveBeenCalledWith({
      name: "Grade One",
      code: null,
      level: 1,
      is_active: true,
    });
  });

  it("refuses a level that isn't a whole number from 1, before sending", async () => {
    const user = renderSection();

    await screen.findByRole("button", { name: "Edit Grade 1" });
    await user.click(screen.getByRole("button", { name: "Add class" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Nursery");
    await user.type(within(dialog).getByLabelText("Level"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter a whole number from 1.")).toBeInTheDocument();
    expect(so.createClass).not.toHaveBeenCalled();
  });

  it("edits a class, keeping its level", async () => {
    so.updateClass.mockResolvedValue(classRecord({ name: "Class 1" }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Grade 1" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Class 1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateClass).toHaveBeenCalledWith(CLASS_ID, {
        name: "Class 1",
        code: "G1",
        level: 1,
        is_active: true,
      });
    });
  });

  it("keeps an inactive class's sections read only, but still removable", async () => {
    so.fetchClassSections.mockResolvedValue([sectionRecord({ class_id: retired.id })]);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Prep" }));

    expect(
      await screen.findByText(
        "This class is inactive, so its sections can't be added to or edited.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit A" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove A" })).toBeInTheDocument();
  });

  it("removes a section, and shows a refusal inline", async () => {
    const refusal = referenced(["student enrollments"], "/sections");
    so.deleteSection.mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Remove A" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByText(refusal.message)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(so.deleteSection).toHaveBeenCalledWith(sectionRecord().id);
  });

  it("removes a class, and shows the server's refusal while sections point at it", async () => {
    const refusal = referenced(["sections"], "/classes");
    so.deleteClass.mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Remove Grade 10" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    // The refusal shows inline and the dialog stays open.
    expect(await within(dialog).findByText(refusal.message)).toBeInTheDocument();
    expect(so.deleteClass).toHaveBeenCalledWith(GRADE_10_ID);

    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(so.deleteClass).toHaveBeenCalledTimes(2);
  });

  it("edits a section from its saved values", async () => {
    so.updateSection.mockResolvedValue(sectionRecord({ capacity: 40 }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Edit A" }));
    const dialog = await screen.findByRole("dialog");
    // Prefilled from the row (`recordToSectionFormValues`).
    expect(within(dialog).getByLabelText("Name")).toHaveValue("A");
    const capacity = within(dialog).getByLabelText("Capacity");
    expect(capacity).toHaveValue("30");
    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Campus" })).toHaveTextContent(
        "Main Campus",
      );
    });
    expect(within(dialog).getByRole("combobox", { name: "Class" })).toHaveTextContent("Grade 1");

    await user.clear(capacity);
    await user.type(capacity, "40");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateSection).toHaveBeenCalledWith(sectionRecord().id, {
        class_id: CLASS_ID,
        campus_id: CAMPUS_ID,
        name: "A",
        capacity: 40,
        is_active: true,
      });
    });
    expect(so.createSection).not.toHaveBeenCalled();
  });

  it("keeps an edited section's since-deactivated campus in the campus picker", async () => {
    // The API's own `is_active` filter: only the all-campus list holds the old campus.
    mockFetchCampuses.mockImplementation(({ isActive } = {}) =>
      Promise.resolve(
        isActive
          ? [{ id: CAMPUS_ID, name: "Main Campus" }]
          : [
              { id: CAMPUS_ID, name: "Main Campus" },
              { id: OLD_CAMPUS_ID, name: "Old Campus" },
            ],
      ),
    );
    so.fetchClassSections.mockResolvedValue([sectionRecord({ campus_id: OLD_CAMPUS_ID })]);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Edit A" }));
    const dialog = await screen.findByRole("dialog");
    const campusPicker = within(dialog).getByRole("combobox", { name: "Campus" });
    await waitFor(() => {
      expect(campusPicker).toHaveTextContent("Old Campus (inactive)");
    });

    await user.click(campusPicker);
    expect(await screen.findByRole("option", { name: "Main Campus" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Old Campus (inactive)" })).toBeInTheDocument();
  });

  it("shows the server's refusal of an inactive campus under the campus field", async () => {
    const CAMPUS_INACTIVE = "Campus is inactive.";
    so.updateSection.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: CAMPUS_INACTIVE,
        status: 400,
        url: "/sections",
        details: [{ field: "campus_id", issue: CAMPUS_INACTIVE }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    await user.click(await screen.findByRole("button", { name: "Edit A" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(CAMPUS_INACTIVE)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the classes and sections only, to a viewer without the write keys", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["school.class.view", "school.section.view"]));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Show sections for Grade 1" }));
    expect(await screen.findByRole("table", { name: "Sections of Grade 1" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Add class" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Add section" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Edit|Remove) / })).toBeNull();
  });
});
