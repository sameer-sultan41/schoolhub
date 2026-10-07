import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { ClassSectionFields } from "../class-section-fields";

jest.mock("@/services", () => ({
  Services: {
    schoolOrganization: {
      fetchClasses: jest.fn(),
      fetchSections: jest.fn(),
    },
  },
}));

const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;

interface TestFormValues {
  class_id: string;
  section_id: string;
}

function UnlockedHarness({ campusId = "campus-1" }: { campusId?: string }) {
  const form = useForm<TestFormValues>({ defaultValues: { class_id: "", section_id: "" } });
  return (
    <ClassSectionFields
      form={form}
      campusId={campusId}
      locked={false}
      classFieldName="class_id"
      sectionFieldName="section_id"
    />
  );
}

function LockedHarness({
  campusId = "campus-2",
  currentClass = { id: "class-1", name: "Grade 1" },
}: {
  campusId?: string;
  currentClass?: { id: string; name: string };
}) {
  const form = useForm<TestFormValues>({ defaultValues: { class_id: "", section_id: "" } });
  return (
    <ClassSectionFields
      form={form}
      campusId={campusId}
      locked
      currentClass={currentClass}
      sectionFieldName="section_id"
    />
  );
}

describe("ClassSectionFields", () => {
  beforeEach(() => {
    mockFetchClasses.mockReset();
    mockFetchSections.mockReset();
    mockFetchClasses.mockResolvedValue([
      { id: "grade-1", name: "Grade 1" },
      { id: "grade-2", name: "Grade 2" },
    ]);
    mockFetchSections.mockResolvedValue([{ id: "section-a", name: "A" }]);
  });

  it("unlocked: fetches sections scoped to the chosen class and the given campusId, with isActive true", async () => {
    renderWithProviders(<UnlockedHarness campusId="campus-1" />);

    await userEvent.click(screen.getByRole("combobox", { name: /class/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));

    expect(mockFetchSections).toHaveBeenCalledWith({
      classId: "grade-1",
      campusId: "campus-1",
      isActive: true,
    });
    expect(mockFetchClasses).toHaveBeenCalledWith({ isActive: true });
  });

  it("locked: renders currentClass as fixed text and only the section select is interactive", async () => {
    renderWithProviders(
      <LockedHarness campusId="campus-2" currentClass={{ id: "class-1", name: "Grade 1" }} />,
    );

    expect(screen.queryByRole("combobox", { name: /^class$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /section/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await screen.findByRole("option", { name: "A" });

    expect(mockFetchSections).toHaveBeenCalledWith({
      classId: "class-1",
      campusId: "campus-2",
      isActive: true,
    });
  });

  it("resets the chosen section when the class changes in unlocked mode", async () => {
    mockFetchSections.mockResolvedValueOnce([{ id: "section-a", name: "A" }]);
    mockFetchSections.mockResolvedValueOnce([{ id: "section-b", name: "B" }]);
    renderWithProviders(<UnlockedHarness />);

    await userEvent.click(screen.getByRole("combobox", { name: /class/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));
    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));

    await userEvent.click(screen.getByRole("combobox", { name: /class/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 2" }));

    expect(screen.getByRole("combobox", { name: /section/i })).toHaveTextContent(
      /select a section/i,
    );
  });

  it("section select is disabled until a class is chosen (unlocked mode)", () => {
    renderWithProviders(<UnlockedHarness />);

    expect(screen.getByRole("combobox", { name: /section/i })).toBeDisabled();
  });
});
